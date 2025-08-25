(function () {
    CJS.register("config.js", function (require, module, exports) {
        class Config {
            constructor() {
                this.theme = "light";
                this.VALID_THEME_LIST_ = ["light", "dark"];
                this.THEME_STYLE_LIST = {
                    dark: "theme/dark/style.json",
                    light: "theme/light/style.json",
                };
                this.THEME_CSS_LIST = {
                    dark: "./theme/dark/style.css",
                    light: "./theme/light/style.css",
                };

                this.colorScheme = "RSD";
                this.windowBounds = { x: 0, y: 0, width: 1024, height: 768 };
                this.splitterPosition = 450;
                this.drawDetailedlyThreshold = 1;
                this.drawDependencyThreshold = 4;
                this.drawFrameThreshold = 4;
                this.drawTextThreshold = 10;
                this.drawZoomFactor = 1;
                this.depArrowType = "notShow";
                this.VALID_DEP_ARROW_TYPES_ = [
                    "insideLine",
                    "leftSideCurve",
                    "notShow",
                ];
                this.recentLoadedFiles = [];
                this.bookmarks = Array.from({ length: 10 }, () => ({
                    x: 0,
                    y: 0,
                    zoom: 0,
                }));
                this.commandHistory = [];
                this.maxCommandHistoryNum = 20;
                // Relax yields a bit for faster bulk parsing (still UI-friendly)
                this.parsingYieldInterval = 16384; // Lines processed before yielding control
                this.streamYieldInterval = 16384; // Lines processed before yielding in streaming
                // Compaction behavior: 1 = compact at finish, 0 = skip compaction
                this.compactOnFinish = 1;
                this.customColorSchemes = {
                    Custom: {
                        enable: 0,
                        defaultColor: { h: "100", s: "auto", l: "auto" },
                        0: {
                            F: { h: "0", s: "auto", l: "auto" },
                            Rn: { h: "60", s: "auto", l: "auto" },
                            Dc: { h: "120", s: "auto", l: "auto" },
                            Is: { h: "180", s: "auto", l: "auto" },
                            Cm: { h: "240", s: "auto", l: "auto" },
                            f: { h: "0", s: "0", l: "auto" },
                        },
                        1: { stl: { h: "0", s: "0", l: "auto" } },
                    },

                    RSD: {
                        0: {
                            Np: {
                                h: "300",
                                s: "auto",
                                l: "auto",
                            },
                            F: {
                                h: "270",
                                s: "auto",
                                l: "auto",
                            },
                            Pd: {
                                h: "240",
                                s: "auto",
                                l: "auto",
                            },
                            Dc: {
                                h: "220",
                                s: "auto",
                                l: "auto",
                            },
                            Rn: {
                                h: "180",
                                s: "auto",
                                l: "auto",
                            },
                            Ds: {
                                h: "150",
                                s: "auto",
                                l: "auto",
                            },
                            Sc: {
                                h: "120",
                                s: "auto",
                                l: "auto",
                            },
                            Is: {
                                h: "90",
                                s: "auto",
                                l: "auto",
                            },
                            Rr: {
                                h: "60",
                                s: "auto",
                                l: "auto",
                            },
                            X: {
                                h: "30",
                                s: "auto",
                                l: "auto",
                            },
                            Mt: {
                                h: "0",
                                s: "auto",
                                l: "auto",
                            },
                            Ma: {
                                h: "330",
                                s: "auto",
                                l: "auto",
                            },
                            Rw: {
                                h: "300",
                                s: "auto",
                                l: "auto",
                            },
                            f: {
                                h: "0",
                                s: "0",
                                l: "auto",
                            },
                            Cm: {
                                h: "280",
                                s: "auto",
                                l: "auto",
                            },
                        },
                        1: {
                            wat: {
                                h: "90",
                                s: "24",
                                l: "auto",
                            },
                            stl: {
                                h: "0",
                                s: "0",
                                l: "75",
                            },
                            rsc: {
                                h: "0",
                                s: "24",
                                l: "auto",
                            },
                        },
                        enable: 1,
                        defaultColor: {
                            h: "20",
                            s: "auto",
                            l: "auto",
                        },
                    },
                };
                this.load();
            }
            check_(name, validList) {
                let value = this[name];
                if (validList.indexOf(value) === -1) this[name] = validList[0];
            }
            onLoadFile(file) {
                let name =
                    typeof file === "string" ? file : (file && file.name) || "";
                let files = this.recentLoadedFiles.filter((f) => f !== name);
                files.unshift(name);
                while (files.length > 10) files.pop();
                this.recentLoadedFiles = files;
                this.save();
            }
            load() {
                try {
                    let raw = localStorage.getItem("konata_config");
                    if (raw) {
                        let data = JSON.parse(raw);
                        for (let k in data) {
                            if (!k.match(/^[A-Z_]+$/) && k in this)
                                this[k] = data[k];
                        }
                    }
                } catch (e) {
                    /* ignore */
                }
                this.check_("theme", this.VALID_THEME_LIST_);
                this.check_("depArrowType", this.VALID_DEP_ARROW_TYPES_);
            }
            save() {
                try {
                    let saved = {};
                    for (let k of Object.keys(this))
                        if (!k.match(/^[A-Z_]+$/)) saved[k] = this[k];
                    localStorage.setItem(
                        "konata_config",
                        JSON.stringify(saved),
                    );
                } catch (e) {
                    /* ignore */
                }
            }
            get configItems() {
                return {
                    drawTextThreshold: {
                        comment:
                            "Texts shown when zoomed out more. [Default: 10 CSS pixel]",
                    },
                    drawDetailedlyThreshold: {
                        comment:
                            "Colors applied when zoomed out more. [Default: 1 CSS pixel]",
                    },
                    drawDependencyThreshold: {
                        comment:
                            "Arrows drawn when zoomed out more. [Default: 4 CSS pixel]",
                    },
                    drawFrameThreshold: {
                        comment:
                            "Frames drawn when zoomed out more. [Default: 4 CSS pixel]",
                    },
                    drawZoomFactor: {
                        comment: "Zoom granularity factor. [Default: 1]",
                    },
                    parsingYieldInterval: {
                        comment:
                            "Lines processed before yielding control during parsing. Lower = more responsive UI, higher = faster parsing. [Default: 16384]",
                    },
                    streamYieldInterval: {
                        comment:
                            "Lines processed before yielding control during streaming. Lower = more responsive UI, higher = faster streaming. [Default: 16384]",
                    },
                    compactOnFinish: {
                        comment:
                            "Whether to compact pages at the end (1=yes, 0=skip). Skipping reduces end-of-load spike at the cost of memory. [Default: 1]",
                    },
                };
            }
        }
        module.exports.Config = Config;
    });
})();
