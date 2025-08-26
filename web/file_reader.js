(function () {
    CJS.register("file_reader.js", function (require, module, exports) {
        class FileReader {
            constructor() {
                this.file_ = null; // File or URL string
                this.fileSize_ = 0;
                this.bytesRead_ = 0;
                this.extension_ = "";
            }
            open(fileOrUrl) {
                if (fileOrUrl instanceof File) {
                    this.file_ = fileOrUrl;
                    this.fileSize_ = fileOrUrl.size;
                    this.extension_ = (fileOrUrl.name.match(/\.[^.]+$/) || [
                        "",
                    ])[0];
                } else if (typeof fileOrUrl === "string") {
                    // URL fetch fallback
                    this.file_ = fileOrUrl;
                    this.fileSize_ = 0;
                    this.extension_ = (fileOrUrl.match(/\.[^.]+$/) || [""])[0];
                } else {
                    throw new Error("Unsupported file type");
                }
            }
            close() {
                /* no-op for browser */
            }
            getPath() {
                return (this.file_ && this.file_.name) || this.file_ || "";
            }
            readlines(onLine, onFinish, config = null) {
                const self = this;
                (async function () {
                    try {
                        // Get yield interval from config, with Chrome detection fallback
                        let yieldInterval = 4096;
                        if (config && config.streamYieldInterval) {
                            yieldInterval = config.streamYieldInterval;
                        } else {
                            // Chrome detection fallback
                            const isChrome =
                                /Chrome/.test(navigator.userAgent) &&
                                /Google Inc/.test(navigator.vendor);
                            yieldInterval = isChrome ? 2048 : 4096;
                        }
                        let stream;
                        // Reset counters
                        self.bytesRead_ = 0;
                        if (self.file_ instanceof File) {
                            stream = self.file_.stream();
                            self.fileSize_ = self.file_.size || 0;
                        } else {
                            const res = await fetch(self.file_);
                            // Try to use Content-Length when available
                            const len = res.headers && res.headers.get
                                ? Number(res.headers.get("Content-Length"))
                                : 0;
                            if (!Number.isNaN(len) && len > 0) self.fileSize_ = len;
                            stream = res.body;
                        }
                        // gzip support
                        const isGz =
                            self.extension_ === ".gz" ||
                            (self.file_ &&
                                self.file_.type === "application/gzip");
                        if (isGz) {
                            if (window.DecompressionStream) {
                                // Count compressed bytes BEFORE decompression
                                const counting = new TransformStream({
                                    transform(chunk, controller) {
                                        if (chunk) self.bytesRead_ += chunk.byteLength;
                                        controller.enqueue(chunk);
                                    },
                                });
                                stream = stream
                                    .pipeThrough(counting)
                                    .pipeThrough(new DecompressionStream("gzip"));
                            } else if (window.pako) {
                                // Streaming fallback using pako.Inflate
                                let buf;
                                if (self.file_ instanceof File) {
                                    buf = new Uint8Array(
                                        await self.file_.arrayBuffer(),
                                    );
                                } else {
                                    buf = new Uint8Array(
                                        await (
                                            await fetch(self.file_)
                                        ).arrayBuffer(),
                                    );
                                }
                                self.fileSize_ = buf.byteLength;
                                const inflator = new window.pako.Inflate({
                                    to: "string",
                                });
                                let carry = "";
                                let lineCount = 0;
                                inflator.onData = async (str) => {
                                    let chunk = carry + str;
                                    let parts = chunk.split(/\r?\n/);
                                    carry = parts.pop();
                                    for (let line of parts) {
                                        await onLine(line);
                                        lineCount++;
                                        if (lineCount % yieldInterval === 0) {
                                            await new Promise((r) =>
                                                setTimeout(r, 0),
                                            );
                                        }
                                    }
                                };
                                const CHUNK = 256 * 1024; // 256KB compressed chunks
                                for (let off = 0; off < buf.byteLength; off += CHUNK) {
                                    const end = Math.min(buf.byteLength, off + CHUNK);
                                    const last = end >= buf.byteLength;
                                    self.bytesRead_ += end - off; // count compressed bytes
                                    inflator.push(buf.subarray(off, end), last);
                                    // Yield periodically to keep UI responsive
                                    if ((off / CHUNK) % Math.max(1, yieldInterval / 1024) === 0) {
                                        await new Promise((r) => setTimeout(r, 0));
                                    }
                                }
                                if (inflator.err) throw inflator.msg || "pako inflate error";
                                const tail = inflator.result || "";
                                if (tail) {
                                    let chunk = carry + tail;
                                    let parts = chunk.split(/\r?\n/);
                                    carry = parts.pop();
                                    for (let line of parts) await onLine(line);
                                }
                                if (carry) await onLine(carry);
                                onFinish();
                                return;
                            }
                        }
                        // Decode to text and stream lines
                        // Read bytes and decode; for non-gzip or DecompressionStream path,
                        // compressed byte counting is handled by the TransformStream above
                        const reader = stream.getReader();
                        const decoder = new TextDecoder();
                        let carry = "";
                        let lineCount = 0;
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            // Only count here for non-gzip/no-counting-transform path
                            if (!isGz && value && value.byteLength)
                                self.bytesRead_ += value.byteLength;
                            const text = decoder.decode(value, { stream: true });
                            let chunk = carry + text;
                            let parts = chunk.split(/\r?\n/);
                            carry = parts.pop();
                            for (let line of parts) {
                                await onLine(line);
                                lineCount++;
                                if (lineCount % yieldInterval === 0) {
                                    await new Promise((resolve) => setTimeout(resolve, 0));
                                }
                            }
                        }
                        const tail = decoder.decode();
                        if (tail || carry) await onLine(carry + tail);
                        onFinish();
                    } catch (e) {
                        console.error(e);
                        onFinish();
                    }
                })();
            }
            get fileSize() {
                return this.fileSize_;
            }
            get bytesRead() {
                return this.bytesRead_;
            }
            getExtension() {
                return this.extension_;
            }
        }
        module.exports.FileReader = FileReader;
    });
})();
