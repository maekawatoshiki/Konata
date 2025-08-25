(function () {
    // Minimal CommonJS loader with sync fetch and relative resolution
    let modules = {}; // id -> factory(require,module,exports)
    let cache = {}; // id -> module.exports

    function normalize(path) {
        let parts = path.split("/");
        let out = [];
        for (let i = 0; i < parts.length; i++) {
            let p = parts[i];
            if (!p || p === ".") continue;
            if (p === "..") out.pop();
            else out.push(p);
        }
        return out.join("/");
    }

    function addExt(id) {
        if (/\.(js|json)$/.test(id)) return id;
        return id + ".js";
    }

    function resolve(id, base) {
        if (id.startsWith(".")) {
            let baseDir =
                base && base.indexOf("/") !== -1
                    ? base.replace(/\/[^/]*$/, "")
                    : "";
            return normalize(addExt(baseDir ? baseDir + "/" + id : id));
        }
        return id; // bare id for shims
    }

    function fetchTextSync(url) {
        let xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        xhr.send(null);
        if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 0) {
            return xhr.responseText;
        }
        throw new Error("Failed to load " + url + ": " + xhr.status);
    }

    function loadModule(id) {
        if (modules[id]) return; // registered already
        // Load from ./web directory
        if (id.endsWith(".json")) {
            let json = fetchTextSync("./" + id);
            modules[id] = function (require, module, exports) {
                module.exports = JSON.parse(json);
            };
            return;
        }
        let src = fetchTextSync("./" + id);
        // Wrap in factory
        let factory = new Function(
            "require",
            "module",
            "exports",
            src + "\n//# sourceURL=" + id,
        );
        modules[id] = factory;
    }

    function requireFn(id, base) {
        let resolved = resolve(id, base);
        if (!modules[resolved]) loadModule(resolved);
        if (cache[resolved]) return cache[resolved];
        let module = { exports: {} };
        cache[resolved] = module.exports;
        let localRequire = function (rel) {
            return requireFn(rel, resolved);
        };
        // Shims registered as bare ids
        if (modules[resolved]) {
            modules[resolved](localRequire, module, module.exports);
        } else {
            throw new Error("Module not found: " + resolved);
        }
        cache[resolved] = module.exports;
        return module.exports;
    }

    window.CJS = {
        register: function (id, factory) {
            modules[id] = factory;
        },
        require: function (id) {
            return requireFn(id, "");
        },
        _modules: modules,
        _cache: cache,
    };
})();
