// Simplified port of op_list.js for web (unchanged logic)
let Op = require("./op").Op;
let zlib = require("zlib");

class BigKeyValueStoreConfigLarge {
    constructor() {
        this.PAGE_SIZE_BITS_MAP = [13, 10, 10, 10, 10];
        this.PAGE_LEVEL_MAP = [1, 8, 64, 512, 4096];
        this.MAX_DECOMPRESSED_PAGES = 4;
        this.CACHE_SIZE = 1024 * 8;
    }
}
class BigKeyValueStoreConfigDefault {
    constructor() {
        // Larger pages -> fewer page switches, higher memory locality
        this.PAGE_SIZE_BITS_MAP = [10, 10, 10, 10, 10]; // 1024 entries per level
        this.PAGE_LEVEL_MAP = [1, 8, 64, 512, 4096];
        // Constrain decompressed pages more aggressively on Chrome to avoid OOM
        const isChrome =
            typeof navigator !== "undefined" &&
            /Chrome/.test(navigator.userAgent || "") &&
            /Google Inc/.test(navigator.vendor || "");
        this.MAX_DECOMPRESSED_PAGES = isChrome ? 48 : 128;
        this.CACHE_SIZE = isChrome ? 1024 * 16 : 1024 * 32;
    }
}
class BigKeyValueStoreConfigTest {
    constructor() {
        this.PAGE_SIZE_BITS_MAP = [8];
        this.PAGE_LEVEL_MAP = [1];
        this.MAX_DECOMPRESSED_PAGES = 4;
        this.CACHE_SIZE = 16;
    }
}

class LinkedListMapNode {
    constructor() {
        this.id = -1;
        this.op = null;
        this.next = null;
        this.prev = null;
    }
}
class LinkedListMap {
    constructor() {
        this.size_ = 0;
        this.map_ = {};
        this.head_ = new LinkedListMapNode();
        this.tail_ = new LinkedListMapNode();
        this.head_.next = this.tail_;
        this.tail_.prev = this.head_;
    }
    has(id) {
        return id in this.map_;
    }
    set(id, op) {
        if (id in this.map_) {
            this.map_[id].op = op;
            this.moveToBack(id);
            return;
        }
        let node = new LinkedListMapNode();
        node.id = id;
        node.op = op;
        this.map_[id] = node;
        let tail = this.tail_.prev;
        tail.next = node;
        node.prev = tail;
        node.next = this.tail_;
        this.tail_.prev = node;
        this.size_++;
    }
    get(id) {
        return this.map_[id].op;
    }
    delete(id) {
        if (id in this.map_ && id != -1) {
            let node = this.map_[id];
            node.prev.next = node.next;
            node.next.prev = node.prev;
            node.op = null;
            node.prev = null;
            node.next = null;
            delete this.map_[id];
            this.size_--;
        }
    }
    moveToBack(id) {
        if (id in this.map_) {
            let node = this.map_[id];
            node.prev.next = node.next;
            node.next.prev = node.prev;
            let tail = this.tail_.prev;
            tail.next = node;
            node.prev = tail;
            node.next = this.tail_;
            this.tail_.prev = node;
        }
    }
    deleteHead() {
        let head = this.head_.next;
        if (head.id != -1) {
            this.delete(head.id);
        }
    }
    get size() {
        return this.size_;
    }
}

class OpListPage {
    idToPageIndex(id) {
        return id >> this.pageSizeBits_;
    }
    pageIndexToID(pageIndex) {
        return pageIndex << this.pageSizeBits_;
    }
    constructor(headID, pageSizeBits, pageSize) {
        this.pageSizeBits_ = pageSizeBits;
        this.pageSize_ = pageSize;
        this.headID_ = headID;
        this.opList_ = [];
        this.compressedData_ = null;
        this.decompressedDataExists_ = true;
        this.isCompressing_ = false;
        this.dirty_ = false;
    }
    toLocalIndex_(id) {
        return id - this.headID_;
    }
    setOp(id, op) {
        let index = this.toLocalIndex_(id);
        this.opList_[index] = op;
        this.dirty_ = true;
    }
    getOp(id) {
        let index = this.toLocalIndex_(id);
        if (!this.decompressedDataExists_) {
            this.decompress();
        }
        return this.opList_[index];
    }
    compress() {
        if (!this.dirty_ || this.isCompressing_) return;
        if (!this.decompressedDataExists_) return;
        this.isCompressing_ = true;
        let json = JSON.stringify(this.opList_);
        zlib.gzip(json, (error, data) => {
            this.compressedData_ = data;
            this.opList_ = [];
            this.decompressedDataExists_ = false;
            this.isCompressing_ = false;
            this.dirty_ = false;
        });
    }
    decompress() {
        if (this.decompressedDataExists_) return;
        let json = zlib.gunzipSync(this.compressedData_).toString();
        this.opList_ = JSON.parse(json);
        this.decompressedDataExists_ = true;
        this.isCompressing_ = false;
    }
    purgeDecompressedData() {
        this.compress();
        if (!this.isCompressing_) {
            this.opList_ = [];
            this.decompressedDataExists_ = false;
        }
    }
    get isCompressed() {
        return !this.decompressedDataExists_;
    }
}

class OpPageStore {
    constructor(name, pageSizeBits, pageSize, maxDecompressedPages) {
        this.pageSizeBits_ = pageSizeBits;
        this.pageSize_ = pageSize;
        this.maxDecompressedPages_ = maxDecompressedPages;
        this.name_ = name;
        this.opPages_ = [];
        this.decompressedPageSet_ = new Set();
        this.numPageDecompress_ = 0;
        this.compressionEnabled_ = true;
    }
    idToPageIndex(id) {
        return id >> this.pageSizeBits_;
    }
    pageIndexToID(pageIndex) {
        return pageIndex << this.pageSizeBits_;
    }
    close() {
        this.opPages_ = [];
        this.decompressedPageSet_ = new Set();
    }
    setCompressionEnabled(enabled) {
        this.compressionEnabled_ = !!enabled;
    }
    set(id, op) {
        if (id < 0) return;
        let pageIndex = this.idToPageIndex(id);
        if (pageIndex >= this.opPages_.length) {
            let cur = this.opPages_.length;
            while (cur <= pageIndex) {
                let page = new OpListPage(
                    this.pageIndexToID(cur),
                    this.pageSizeBits_,
                    this.pageSize_,
                );
                this.opPages_[cur] = page;
                this.updateReplacement_(cur, true);
                cur++;
            }
        }
        this.updateReplacement_(pageIndex, false);
        this.opPages_[pageIndex].setOp(id, op);
    }
    get(id) {
        if (id < 0) return null;
        let pageIndex = this.idToPageIndex(id);
        if (pageIndex >= this.opPages_.length) return null;
        let page = this.opPages_[pageIndex];
        if (!page) return null;
        this.updateReplacement_(pageIndex, false);
        return page.getOp(id);
    }
    getPage_(pageIndex) {
        if (pageIndex >= this.opPages_.length) return null;
        return this.opPages_[pageIndex];
    }
    updateReplacement_(pageIndex, initialTouch) {
        let page = this.getPage_(pageIndex);
        if (!page) return;
        if (page.isCompressed || initialTouch) {
            if (page.isCompressed) {
                page.decompress();
                this.numPageDecompress_++;
            }
            this.decompressedPageSet_.add(pageIndex);
            if (
                this.compressionEnabled_ &&
                this.decompressedPageSet_.size > this.maxDecompressedPages_
            ) {
                let compress = this.decompressedPageSet_.keys().next().value;
                this.decompressedPageSet_.delete(compress);
                let target = this.opPages_[compress];
                if (this.compressionEnabled_) target.purgeDecompressedData();
            }
        } else {
            this.decompressedPageSet_.delete(pageIndex);
            this.decompressedPageSet_.add(pageIndex);
        }
    }
    compressAll() {
        if (!this.opPages_) return;
        for (let i = 0; i < this.opPages_.length; i++) {
            let p = this.opPages_[i];
            if (!p) continue;
            p.compress();
            // Ensure we actually drop decompressed data now
            if (!p.isCompressing_) {
                p.purgeDecompressedData();
            }
        }
        this.decompressedPageSet_ = new Set();
    }
    async compressAllAsync(onPage, yieldEvery = 8) {
        if (!this.opPages_) return 0;
        let processed = 0;
        for (let i = 0; i < this.opPages_.length; i++) {
            let p = this.opPages_[i];
            if (!p) continue;
            // Yield periodically to keep UI responsive
            if (processed % yieldEvery === 0)
                await new Promise((r) => setTimeout(r, 0));
            p.compress();
            if (!p.isCompressing_) p.purgeDecompressedData();
            processed++;
            if (onPage) onPage(processed);
        }
        this.decompressedPageSet_ = new Set();
        return processed;
    }
}

class OpCache {
    constructor(size) {
        this.size_ = size;
        this.numAccess_ = 0;
        this.numHit_ = 0;
        this.cache_ = new LinkedListMap();
    }
    cacheWrite(id, op) {
        this.cache_.set(id, op);
        if (this.cache_.size > this.size_) this.cache_.deleteHead();
    }
    cacheRead(id, resolutionLevel) {
        this.numAccess_++;
        if (this.numAccess_ > 10000) {
            this.numAccess_ = 0;
            this.numHit_ = 0;
        }
        if (this.cache_.has(id)) {
            this.numHit_++;
            let op = this.cache_.get(id);
            this.cache_.moveToBack(id);
            return op;
        } else return null;
    }
    invalidate(id) {
        if (this.cache_.has(id)) {
            this.cache_.delete(id);
            return true;
        }
        return false;
    }
}

class BigKeyValueStore {
    constructor(config) {
        this.config_ = config;
        this.page_ = [];
        this.cache_ = null;
        this.setup_();
        this.numAccess_ = 0;
        this.numHit_ = 0;
        this.compressionEnabled_ = true;
    }
    setup_() {
        this.page_ = [];
        let PAGE_LEVEL_NUM = this.config_.PAGE_LEVEL_MAP.length;
        let PAGE_SIZE_MAP = this.config_.PAGE_SIZE_BITS_MAP.map((bits) => {
            return 1 << bits;
        });
        for (let i = 0; i < PAGE_LEVEL_NUM; i++) {
            this.page_.push(
                new OpPageStore(
                    `lv${i}`,
                    this.config_.PAGE_SIZE_BITS_MAP[i],
                    PAGE_SIZE_MAP[i],
                    this.config_.MAX_DECOMPRESSED_PAGES,
                ),
            );
            this.page_[i].setCompressionEnabled(this.compressionEnabled_);
        }
        this.cache_ = new OpCache(this.config_.CACHE_SIZE);
    }
    close() {
        this.page_.map((page) => {
            page.close();
        });
        this.setup_();
    }
    setCompressionEnabled(enabled) {
        this.compressionEnabled_ = !!enabled;
        this.page_.forEach((p) =>
            p.setCompressionEnabled(this.compressionEnabled_),
        );
    }
    compressAll() {
        this.page_.forEach((p) => p.compressAll());
    }
    async compressAllAsync(onProgress) {
        // Count total pages first
        let total = 0;
        for (let ps of this.page_)
            total += (ps.opPages_ && ps.opPages_.length) || 0;
        let done = 0;
        for (let ps of this.page_) {
            done += await ps.compressAllAsync(() => {
                if (onProgress) onProgress(done, total);
            });
        }
    }
    invalidateCache_(id) {
        this.cache_.invalidate(id);
    }
    set(id, op) {
        if (id < 0) return;
        this.invalidateCache_(id);
        this.page_.map((page, level) => {
            if (id % this.config_.PAGE_LEVEL_MAP[level] == 0) {
                let blockID = Math.floor(
                    id / this.config_.PAGE_LEVEL_MAP[level],
                );
                page.set(blockID, op);
            }
        });
    }
    cacheWrite_(id, op) {
        this.cache_.cacheWrite(id, op);
    }
    cacheRead_(id, resolutionLevel) {
        this.numAccess_++;
        if (this.numAccess_ > 10000) {
            this.numAccess_ = 0;
            this.numHit_ = 0;
        }
        let op = this.cache_.cacheRead(id, resolutionLevel);
        if (op) {
            this.numHit_++;
            return op;
        }
        return null;
    }
    get(id, resolutionLevel = 0, updateCache) {
        if (id < 0) return null;
        resolutionLevel = Math.floor(resolutionLevel);
        if (resolutionLevel >= 1) {
            id -= id & ((2 << resolutionLevel) - 1);
        }
        let cached = this.cacheRead_(id, resolutionLevel);
        if (cached) return cached;
        let op = null;
        let PAGE_LEVEL_NUM = this.config_.PAGE_LEVEL_MAP.length;
        for (let i = PAGE_LEVEL_NUM - 1; i >= 0; i--) {
            if (id % this.config_.PAGE_LEVEL_MAP[i] == 0) {
                let blockID = Math.floor(id / this.config_.PAGE_LEVEL_MAP[i]);
                op = this.page_[i].get(blockID);
                break;
            }
        }
        if (op && updateCache) this.cacheWrite_(id, op);
        return op;
    }
}

class OpList {
    constructor() {
        this.close();
    }
    close() {
        this.store_ = new BigKeyValueStore(new BigKeyValueStoreConfigDefault());
        this.parsedLastID_ = 0;
        this.parsedLastRID_ = 0;
        this.parsedRIDTable_ = {};
    }
    setOp(id, op) {
        this.store_.set(id, op);
        if (this.parsedLastID_ < id) this.parsedLastID_ = id;
        if (!op.flush && this.parsedLastRID_ < op.rid) {
            this.parsedLastRID_ = op.rid;
            this.parsedRIDTable_[op.rid] = id;
        }
    }
    getParsedOp(id, resolution = 0) {
        return this.store_.get(id, resolution, true);
    }
    getParsedOpFromRID(rid, resolution = 0) {
        let id = this.parsedRIDTable_[rid];
        if (typeof id == "undefined") {
            return null;
        }
        return this.getParsedOp(id, resolution);
    }
    purge() {
        this.store_.close();
    }
    setCompressionEnabled(enabled) {
        this.store_.setCompressionEnabled(enabled);
    }
    compressAll() {
        this.store_.compressAll();
    }
    async compressAllAsync(onProgress) {
        await this.store_.compressAllAsync(onProgress);
    }
    setParsedLastID(id) {
        this.parsedLastID_ = id;
    }
    get parsedLastID() {
        return this.parsedLastID_;
    }
    get parsedLastRID() {
        return this.parsedLastRID_;
    }
}

class ParsingOpList {
    constructor() {
        this.close();
    }
    close() {
        this.parsingOpList_ = {};
        this.parsingRIDTable_ = {};
        this.parsingLastID_ = 0;
    }
    setOp(id, op) {
        this.parsingOpList_[id] = op;
        if (this.parsingLastID_ < id) this.parsingLastID_ = id;
    }
    getParsingOp(id) {
        if (id in this.parsingOpList_) return this.parsingOpList_[id];
        return null;
    }
    setRID(id, rid) {
        this.parsingRIDTable_[rid] = id;
    }
    getIDFromRID(rid) {
        if (rid in this.parsingRIDTable_) return this.parsingRIDTable_[rid];
        return -1;
    }
    purge(id) {
        delete this.parsingOpList_[id];
    }
    get parsingID_List() {
        return Object.keys(this.parsingOpList_);
    }
    get parsingLastID() {
        return this.parsingLastID_;
    }
}

module.exports.OpList = OpList;
module.exports.ParsingOpList = ParsingOpList;
