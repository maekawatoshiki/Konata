let Op = require("./op").Op;
let OpList = require("./op_list").OpList;
let { ParsingOpList } = require("./op_list");
let Dependency = require("./op").Dependency;
let Stage = require("./stage").Stage;
let StageLevelMap = require("./stage").StageLevelMap;
let Lane = require("./stage").Lane;
let InternalFileReader = require("./file_reader").FileReader;

class Gem5O3PipeViewExLogInfo {
    constructor() {
        this.logList = [];
        this.srcs = [];
        this.dsts = [];
    }
}

class Gem5O3PipeViewParser {
    constructor() {
        this.file_ = null;
        this.updateCallback_ = null;
        this.finishCallback_ = null;
        this.errorCallback_ = null;
        this.curLine_ = 1;
        this.curCycle_ = 0;
        /** @type {OpList} */ this.opListBody_ = new OpList();
        /** @type {ParsingOpList} */ this.secondParsingOpList_ =
            new ParsingOpList();
        this.lastGID_ = -1;
        this.lastNotFlushedID = -1;
        this.curParsingSeqNum_ = 0;
        this.curParsingInsnFlushed_ = false;
        this.curParsingInsnCycle_ = -1;
        /** @type {Object.<string, Op>} */
        this.parsingOpList_ = {};
        /** @type {Object.<string, Gem5O3PipeViewExLogInfo>} */
        this.parsingExLog_ = {};
        this.parsingExLogLastGID_ = -1;
        /** @type {Object.<string, Op>} */
        this.depTable_ = {};
        this.complete_ = false;
        this.laneMap_ = {};
        this.stageLevelMap_ = new StageLevelMap();
        this.startTime_ = 0;
        this.updateTimer_ = 100;
        this.updateCount_ = 0;
        this.closed_ = false;
        this.ticks_per_clock_ = -1;
        this.cycle_begin_ = -1;
        this.gidBegin_ = -1;
        this.isGem5O3PipeView = false;
        this.GIVING_UP_LINE = 20000;
        this.STAGE_ID_FETCH_ = 0;
        this.STAGE_ID_DECODE_ = 1;
        this.STAGE_ID_RENAME_ = 2;
        this.STAGE_ID_DISPATCH_ = 3;
        this.STAGE_ID_ISSUE_ = 4;
        this.STAGE_ID_COMPLETE_ = 5;
        this.STAGE_ID_RETIRE_ = 6;
        this.STAGE_ID_MEM_COMPLETE_ = 7;
        this.STAGE_ID_MAP_ = {
            fetch: 0,
            decode: 1,
            rename: 2,
            dispatch: 3,
            issue: 4,
            complete: 5,
            retire: 6,
            mem_complete: 7,
        };
        this.STAGE_LABEL_MAP_ = ["F", "Dc", "Rn", "Ds", "Is", "Cm", "Rt", "Mc"];
        this.SERIAL_NUMBER_PATTERN = new RegExp("sn:(\\d+)");
        this.yieldInterval_ = 4096; // Lines processed before yielding control
        this.yieldCounter_ = 0;
    }
    close() {
        this.closed_ = true;
        this.opListBody_.close();
        this.parsingOpList_ = {};
        this.parsingExLog_ = {};
        this.depTable_ = {};
        this.laneMap_ = {};
    }
    get name() {
        return "Gem5O3PipeViewParser";
    }
    setFile(
        file,
        updateCallback,
        finishCallback,
        errorCallback,
        config = null,
    ) {
        this.file_ = file;
        this.updateCallback_ = updateCallback;
        this.finishCallback_ = finishCallback;
        this.errorCallback_ = errorCallback;
        this.config_ = config;
        // Use config for yield interval if provided
        if (config && config.parsingYieldInterval) {
            this.yieldInterval_ = config.parsingYieldInterval;
        }
        this.startTime_ = new Date().getTime();
        this.startParsing();
        file.readlines(
            this.parseLine.bind(this),
            this.finishParsing.bind(this),
            config,
        );
    }
    getOp(id, resolution = 0) {
        return this.opListBody_.getParsedOp(id, resolution);
    }
    getOpFromRID(rid, resolution = 0) {
        return this.opListBody_.getParsedOpFromRID(rid, resolution);
    }
    get lastID() {
        return this.opListBody_.parsedLastID;
    }
    get lastRID() {
        return this.opListBody_.parsedLastRID;
    }
    get laneMap() {
        return this.laneMap_;
    }
    get stageLevelMap() {
        return this.stageLevelMap_;
    }
    get lastCycle() {
        return this.curCycle_;
    }
    startParsing() {
        this.complete_ = false;
        this.curCycle_ = 0;
        // Keep compression enabled for large files or Chrome to cap memory use.
        // Heuristic: disable compression only for small files in non-Chrome.
        const isChrome =
            /Chrome/.test(navigator.userAgent || "") &&
            /Google Inc/.test(navigator.vendor || "");
        const size = (this.file_ && this.file_.fileSize) || 0;
        const smallFile = size > 0 && size <= 25 * 1024 * 1024; // <= 25MB
        const enableCompressionDuringParse = isChrome || !smallFile;
        if (this.opListBody_ && this.opListBody_.setCompressionEnabled) {
            this.opListBody_.setCompressionEnabled(enableCompressionDuringParse);
        }
    }
    async parseLine(line) {
        try {
            await this.parseLineBody_(line);
        } catch (e) {
            this.errorCallback_(false, e);
        }
    }
    async parseLineBody_(line) {
        if (this.closed_) return;
        let args = line.split(":");
        if (args[0] != "O3PipeView") {
            this.curLine_++;
            if (!this.isGem5O3PipeView && this.curLine_ > this.GIVING_UP_LINE) {
                this.errorCallback_(true);
            }
            // extra gem5 logs with sn: pattern
            if (line.indexOf("sn:") >= 0) {
                let m = this.SERIAL_NUMBER_PATTERN.exec(line);
                if (m) {
                    let sn = Number(m[1]);
                    this.parsingExLogLastGID_ = sn;
                    if (!(sn in this.parsingExLog_))
                        this.parsingExLog_[sn] = new Gem5O3PipeViewExLogInfo();
                    this.parsingExLog_[sn].logList.push(args);
                }
            }

            // Yield control to event loop periodically to prevent UI freezing
            this.yieldCounter_++;
            if (this.yieldCounter_ >= this.yieldInterval_) {
                this.yieldCounter_ = 0;
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            return;
        }
        this.isGem5O3PipeView = true;
        let parts = args[1].split(",");
        let cmd = parts[0].trim();
        if (cmd == "sys_clk_domain.clock") {
            this.ticks_per_clock_ = Number(parts[1]);
        } else if (cmd == "tick") {
            let tick = Number(parts[1]);
            if (this.cycle_begin_ < 0) this.cycle_begin_ = tick;
            this.curCycle_ = Math.floor(
                (tick - this.cycle_begin_) /
                    (this.ticks_per_clock_ > 0 ? this.ticks_per_clock_ : 1000),
            );
        } else if (
            cmd == "fetch" ||
            cmd == "decode" ||
            cmd == "rename" ||
            cmd == "dispatch" ||
            cmd == "issue" ||
            cmd == "complete" ||
            cmd == "retire" ||
            cmd == "mem_complete"
        ) {
            let sn = Number(parts[1]);
            let id = sn;
            let op = this.parsingOpList_[id];
            if (!op) {
                op = new Op();
                op.id = id;
                op.gid = sn;
                op.tid = 0;
                op.fetchedCycle = this.curCycle_;
                op.line = this.curLine_;
                this.parsingOpList_[id] = op;
            }
            let laneName = "0";
            let stageName = this.STAGE_LABEL_MAP_[this.STAGE_ID_MAP_[cmd]];
            if (!(laneName in op.lanes)) op.lanes[laneName] = new Lane();
            let laneInfo = op.lanes[laneName];
            if (laneInfo.stages.length > 0) {
                let lastStage = laneInfo.stages[laneInfo.stages.length - 1];
                if (lastStage.endCycle == 0) {
                    lastStage.endCycle = this.curCycle_;
                    laneInfo.level++;
                }
            }
            let stage = new Stage();
            stage.name = stageName;
            stage.startCycle = this.curCycle_;
            laneInfo.stages.push(stage);
            op.lastParsedStage = stage;
            if (stageName.match(/X/)) op.consCycle = this.curCycle_;
            this.laneMap_[laneName] = 1;
            this.stageLevelMap_.update(laneName, stageName, laneInfo);
        } else if (cmd == "retire_status") {
            let sn = Number(parts[1]);
            let id = sn;
            let status = parts[2].trim();
            let op = this.parsingOpList_[id];
            if (!op) return;
            op.rid = ++this.lastNotFlushedID;
            op.retiredCycle = this.curCycle_;
            if (status == "flushed") {
                op.flush = true;
                op.retired = false;
            } else {
                op.flush = false;
                op.retired = true;
            }
            for (let laneName in op.lanes) {
                let stages = op.lanes[laneName].stages;
                if (stages.length > 0) {
                    let stage = stages[stages.length - 1];
                    if (stage.endCycle == 0) stage.endCycle = this.curCycle_;
                }
            }
            this.unescapeLabels(op);
            delete this.parsingOpList_[id];
            this.opListBody_.setOp(id, op);
        }
        this.curLine_++;
        this.updateTimer_--;
        if (this.updateTimer_ < 0) {
            this.updateTimer_ = 1024 * 32;
            let percent =
                (1.0 * this.file_.bytesRead) / (this.file_.fileSize || 1);
            // Avoid reaching 100% before parsing finishes
            percent = Math.min(percent, 0.98);
            this.updateCallback_(percent, this.updateCount_);
            this.updateCount_++;
        }

        // Yield control to event loop periodically to prevent UI freezing
        this.yieldCounter_++;
        if (this.yieldCounter_ >= this.yieldInterval_) {
            this.yieldCounter_ = 0;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    async finishParsing() {
        if (this.closed_) return;
        for (let k in this.parsingOpList_) {
            let op = this.parsingOpList_[k];
            op.retiredCycle = this.curCycle_ + 1;
            op.eof = true;
            this.unescapeLabels(op);
            this.opListBody_.setOp(op.id, op);
        }
        this.opListBody_.setParsedLastID(this.lastNotFlushedID);
        // Finalization phase: compress pages incrementally with progress
        const shouldCompact =
            !this.config_ || this.config_.compactOnFinish !== 0;
        if (
            shouldCompact &&
            this.opListBody_ &&
            this.opListBody_.setCompressionEnabled
        ) {
            this.opListBody_.setCompressionEnabled(true);
            if (this.opListBody_.compressAllAsync) {
                await this.opListBody_.compressAllAsync((done, total) => {
                    let percent = 0.98 + 0.02 * (total > 0 ? done / total : 1);
                    this.updateCallback_(
                        Math.min(percent, 0.999),
                        this.updateCount_,
                    );
                });
            } else if (this.opListBody_.compressAll) {
                this.opListBody_.compressAll();
            }
        }
        this.complete_ = true;
        this.updateCallback_(1.0, this.updateCount_);
        this.finishCallback_();
        console.log(
            `Parsed (${this.name}): ${new Date().getTime() - this.startTime_} ms`,
        );
    }
    unescapeLabels(op) {
        op.labelName = op.labelName.replace(/\\n/g, "\n");
        op.labelDetail = op.labelDetail.replace(/\\n/g, "\n");
        for (let laneName in op.lanes) {
            for (let stage of op.lanes[laneName].stages) {
                stage.labels = stage.labels.replace(/\\n/g, "\n");
            }
        }
    }
}

module.exports.Gem5O3PipeViewParser = Gem5O3PipeViewParser;
