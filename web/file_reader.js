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
                        if (self.file_ instanceof File) {
                            stream = self.file_.stream();
                        } else {
                            const res = await fetch(self.file_);
                            stream = res.body;
                        }
                        // gzip support
                        const isGz =
                            self.extension_ === ".gz" ||
                            (self.file_ &&
                                self.file_.type === "application/gzip");
                        if (isGz) {
                            if (window.DecompressionStream) {
                                stream = stream.pipeThrough(
                                    new DecompressionStream("gzip"),
                                );
                            } else if (window.pako) {
                                // Fallback: read whole file then inflate
                                let buf;
                                if (self.file_ instanceof File) {
                                    buf = await self.file_.arrayBuffer();
                                } else {
                                    buf = await (
                                        await fetch(self.file_)
                                    ).arrayBuffer();
                                }
                                const text = window.pako.ungzip(
                                    new Uint8Array(buf),
                                    { to: "string" },
                                );
                                // Chunk lines to callbacks without blocking too much
                                const lines = text.split(/\r?\n/);
                                for (let i = 0; i < lines.length; i++) {
                                    await onLine(lines[i]);
                                    // Use configurable yield interval
                                    if (i % yieldInterval === 0)
                                        await new Promise((r) =>
                                            setTimeout(r, 0),
                                        );
                                }
                                onFinish();
                                return;
                            }
                        }
                        // Decode to text and stream lines
                        const reader = stream
                            .pipeThrough(new TextDecoderStream())
                            .getReader();
                        let { value, done } = await reader.read();
                        let carry = "";
                        let lineCount = 0;
                        while (!done) {
                            self.bytesRead_ += value.length;
                            let chunk = carry + value;
                            let parts = chunk.split(/\r?\n/);
                            carry = parts.pop();
                            for (let line of parts) {
                                await onLine(line);
                                lineCount++;
                                // Yield control periodically during streaming to prevent UI freezing
                                if (lineCount % yieldInterval === 0) {
                                    await new Promise((resolve) =>
                                        setTimeout(resolve, 0),
                                    );
                                }
                            }
                            ({ value, done } = await reader.read());
                        }
                        if (carry) await onLine(carry);
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
