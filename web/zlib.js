(function () {
    // Minimal zlib shim backed by pako (loaded via CDN)
    CJS.register("zlib", function (require, module, exports) {
        let z = {};
        z.gzip = function (input, cb) {
            try {
                let out =
                    window.pako && window.pako.gzip
                        ? window.pako.gzip(input)
                        : input;
                cb && cb(null, out);
            } catch (e) {
                cb && cb(e);
            }
        };
        z.gunzipSync = function (input) {
            if (window.pako && window.pako.ungzip) {
                try {
                    return window.pako.ungzip(input, { to: "string" });
                } catch (e) {
                    throw e;
                }
            }
            return input; // no-op fallback
        };
        module.exports = z;
    });
})();
