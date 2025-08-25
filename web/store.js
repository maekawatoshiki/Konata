(function () {
    CJS.register("store.js", function (require, module, exports) {
        // ACTION/CHANGE enums (subset sufficient for web app)
        const ACTION = {
            APP_INITIALIZED: 1,
            DIALOG_FILE_OPEN: 10,
            DIALOG_MODAL_MESSAGE: 11,
            DIALOG_MODAL_ERROR: 12,
            COMMAND_PALETTE_OPEN: 13,
            COMMAND_PALETTE_CLOSE: 14,
            COMMAND_PALETTE_EXECUTE: 15,
            FILE_OPEN: 20,
            FILE_RELOAD: 21,
            FILE_CHECK_RELOAD: 22,
            FILE_SHOW_STATS: 23,
            FILE_CLOSE_STATS: 24,
            FILE_SHOW_SETTINGS: 25,
            FILE_CLOSE_SETTINGS: 26,
            SHEET_RESIZE: 40,
            SHEET_SHOW_DEV_TOOL: 41,
            PANE_SPLITTER_MOVE: 50,
            KONATA_CHANGE_COLOR_SCHEME: 60,
            KONATA_TRANSPARENT: 61,
            KONATA_EMPHASIZE_IN_TRANSPARENT: 62,
            KONATA_SYNC_SCROLL: 63,
            KONATA_CHANGE_UI_COLOR_THEME: 64,
            KONATA_CHANGE_SETTINGS: 65,
            KONATA_ZOOM: 73,
            KONATA_ADJUST_POSITION: 74,
            KONATA_MOVE_WHEEL_VERTICAL: 75,
            KONATA_MOVE_WHEEL_HORIZONTAL: 76,
            KONATA_MOVE_PIXEL_DIFF: 77,
            KONATA_MOVE_LOGICAL_POS: 78,
            KONATA_MOVE_LABEL_CLICK: 79,
            KONATA_SET_DEP_ARROW_TYPE: 88,
            KONATA_SPLIT_LANES: 89,
            KONATA_FIX_OP_HEIGHT: 90,
            KONATA_HIDE_FLUSHED_OPS: 91,
            KONATA_FIND_STRING: 92,
            KONATA_FIND_NEXT_STRING: 93,
            KONATA_FIND_PREV_STRING: 94,
            KONATA_FIND_HIDE_RESULT: 95,
            KONATA_GO_TO_BOOKMARK: 96,
            KONATA_SET_BOOKMARK: 97,
        };
        const CHANGE = {
            TAB_OPEN: 100,
            TAB_UPDATE: 101,
            PANE_SIZE_UPDATE: 102,
            PANE_CONTENT_UPDATE: 103,
            DIALOG_FILE_OPEN: 110,
            DIALOG_MODAL_MESSAGE: 111,
            DIALOG_MODAL_ERROR: 112,
            DIALOG_CHECK_RELOAD: 113,
            DIALOG_SHOW_STATS: 114,
            DIALOG_SHOW_SETTINGS: 115,
            COMMAND_PALETTE_OPEN: 116,
            COMMAND_PALETTE_CLOSE: 117,
            MENU_UPDATE: 120,
            SHEET_UPDATE_DEV_TOOL: 190,
            PROGRESS_BAR_START: 200,
            PROGRESS_BAR_UPDATE: 201,
            PROGRESS_BAR_FINISH: 202,
            WINDOW_CSS_UPDATE: 300,
            DIALOG_UPDATE_STATS: 310,
        };

        let KonataRenderer = require("./konata_renderer").KonataRenderer;
        let Konata = require("./konata").Konata;
        let Config = require("./config").Config;

        class Store {
            constructor() {
                this.config = new Config();
                this.tabs = {};
                this.activeTabID = -1;
                this.activeTab = null;
                this.prevTabID = -1;
                this.prevTab = null;
                this.showDevTool = false;
                this.splitLanes = false;
                this.fixOpHeight = false;
                this.isCommandPaletteOpened = false;
                this.isStatsDialogOpened = false;
                this.isSettingsDialogOpened = false;
                this.isAnyDialogOpened = () =>
                    this.isCommandPaletteOpened ||
                    this.isStatsDialogOpened ||
                    this.isSettingsDialogOpened;
                this.on = (ev, fn) => {
                    return [ev, fn];
                };
                this.trigger = (ev, ...args) => {
                    return [ev, args];
                };
                riot.observable(this);
                this.bindHandlers_();

                // Zoom animation state
                this.zoom = {
                    inAnimation: false,
                    diff: 0.0,
                    speed: 1.0,
                    endLevel: 0.0,
                    curLevel: 0.0,
                    basePoint: [0, 0],
                    compensatePos: true,
                    rafId: 0,
                };

                // Scroll animation state
                this.scroll = {
                    inAnimation: false,
                    diff: [0, 0],
                    endPos: [0, 0],
                    curPos: [0, 0],
                    speed: 1.0,
                    rafId: 0,
                };
            }

            bindHandlers_() {
                let self = this;

                // Dialog relays
                self.on(ACTION.DIALOG_MODAL_MESSAGE, (msg) =>
                    self.trigger(CHANGE.DIALOG_MODAL_MESSAGE, msg),
                );
                self.on(ACTION.DIALOG_MODAL_ERROR, (msg) =>
                    self.trigger(CHANGE.DIALOG_MODAL_ERROR, msg),
                );

                // Command palette
                self.on(ACTION.COMMAND_PALETTE_OPEN, function (command) {
                    if (!self.isCommandPaletteOpened) {
                        self.isCommandPaletteOpened = true;
                        self.trigger(CHANGE.COMMAND_PALETTE_OPEN, command);
                    }
                });
                self.on(ACTION.COMMAND_PALETTE_CLOSE, function () {
                    self.isCommandPaletteOpened = false;
                    self.trigger(CHANGE.COMMAND_PALETTE_CLOSE);
                });
                self.on(ACTION.COMMAND_PALETTE_EXECUTE, function (cmd) {
                    let accept = false;
                    if (cmd.match(/j[\s]+(\d+)/)) {
                        if (self.activeTab) {
                            let id = Number(RegExp.$1);
                            let r = self.activeTab.renderer;
                            let pos = r.viewPos;
                            let op = r.getVisibleOp(id);
                            if (op) {
                                self.startScroll([
                                    op.fetchedCycle - pos[0],
                                    id - pos[1],
                                ]);
                            }
                            accept = true;
                        }
                    } else if (cmd.match(/jr[\s](\d+)/)) {
                        if (self.activeTab) {
                            let rid = Number(RegExp.$1);
                            let r = self.activeTab.renderer;
                            let pos = r.viewPos;
                            let op = r.getOpFromRID(rid);
                            let y = r.getPosY_FromRID(rid);
                            if (op) {
                                self.startScroll([
                                    op.fetchedCycle - pos[0],
                                    y - pos[1],
                                ]);
                            }
                            accept = true;
                        }
                    } else if (cmd.match(/^f[\s]+(.+)$/)) {
                        if (self.activeTab) {
                            let target = RegExp.$1;
                            self.trigger(ACTION.KONATA_FIND_STRING, target);
                            accept = true;
                        }
                    } else {
                        self.trigger(
                            CHANGE.DIALOG_MODAL_ERROR,
                            `Failed to parse: ${cmd}`,
                        );
                    }
                    if (accept) {
                        self.config.commandHistory.unshift(cmd);
                        if (
                            self.config.commandHistory.length >
                            self.config.maxCommandHistoryNum
                        )
                            self.config.commandHistory.pop();
                    }
                });

                // File open (accepts File or URL string)
                self.on(ACTION.FILE_OPEN, function (file) {
                    let konata = new Konata();
                    let tabID = 0;
                    try {
                        self.trigger(CHANGE.PROGRESS_BAR_START, tabID, "load");
                        konata.openFile(
                            file, // progress
                            (percent, count) => {
                                self.trigger(
                                    CHANGE.PROGRESS_BAR_UPDATE,
                                    percent,
                                    tabID,
                                    "load",
                                );
                                if (count % 10 == 0)
                                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                            },
                            () => {
                                self.trigger(
                                    CHANGE.PROGRESS_BAR_FINISH,
                                    tabID,
                                    "load",
                                );
                                self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                            },
                            (errorMsg) => {
                                self.trigger(
                                    CHANGE.DIALOG_MODAL_ERROR,
                                    `Failed to load '${(file && file.name) || file}': ${errorMsg}`,
                                );
                            },
                        );
                    } catch (e) {
                        konata.close();
                        self.trigger(
                            CHANGE.DIALOG_MODAL_ERROR,
                            `Failed to load: ${e}`,
                        );
                        return;
                    }

                    self.config.onLoadFile(file);

                    let renderer = new KonataRenderer();
                    renderer.init(konata, self.config);
                    let tab = {
                        id: tabID,
                        fileName: (file && file.name) || file || "",
                        konata,
                        renderer,
                        splitterPos: self.config.splitterPosition,
                        transparent: false,
                        hideFlushedOps: false,
                        emphasize_in_transparent: false,
                        colorScheme: self.config.colorScheme,
                        syncScroll: false,
                        scrollEndPos: [0, 0],
                        curScrollPos: [0, 0],
                        findContext: new (class {
                            constructor() {
                                this.targetPattern = "";
                                this.foundStr = "";
                                this.found = false;
                                this.visibility = false;
                                this.op = null;
                                this.findID = 0;
                                this.flushed = false;
                            }
                        })(),
                    };
                    self.tabs = {};
                    self.tabs[tabID] = tab;
                    self.prevTabID = self.activeTabID;
                    self.activeTabID = tabID;
                    self.activeTab = tab;
                    self.trigger(CHANGE.TAB_OPEN, tab);
                    self.trigger(CHANGE.TAB_UPDATE, tab);
                    self.trigger(CHANGE.PANE_SIZE_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });

                // Stats
                self.on(ACTION.FILE_SHOW_STATS, function () {
                    if (!self.activeTab) return;
                    let tab = self.activeTab;
                    let id = tab.id;
                    self.trigger(CHANGE.PROGRESS_BAR_START, id, "stats");
                    tab.konata.stats(
                        (percent, count) => {
                            self.trigger(
                                CHANGE.PROGRESS_BAR_UPDATE,
                                percent,
                                id,
                                "stats",
                            );
                            if (count % 10 == 0)
                                self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                        },
                        (stats) => {
                            self.trigger(
                                CHANGE.PROGRESS_BAR_FINISH,
                                id,
                                "stats",
                            );
                            self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                            self.isStatsDialogOpened = true;
                            self.trigger(CHANGE.DIALOG_SHOW_STATS, stats);
                        },
                    );
                });
                self.on(ACTION.FILE_CLOSE_STATS, function () {
                    self.isStatsDialogOpened = false;
                });
                self.on(ACTION.FILE_SHOW_SETTINGS, function () {
                    self.isSettingsDialogOpened = true;
                    self.trigger(CHANGE.DIALOG_SHOW_SETTINGS);
                });
                self.on(ACTION.FILE_CLOSE_SETTINGS, function () {
                    self.isSettingsDialogOpened = false;
                });

                // Resize and splitter
                self.on(ACTION.SHEET_RESIZE, function (bounds) {
                    if ("width" in bounds && "height" in bounds) {
                        self.config.windowBounds = bounds;
                    }
                    self.trigger(CHANGE.PANE_SIZE_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });
                self.on(ACTION.PANE_SPLITTER_MOVE, function (pos) {
                    self.config.splitterPosition = pos;
                    if (self.activeTab) self.activeTab.splitterPos = pos;
                    self.trigger(CHANGE.PANE_SIZE_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });

                // Theme & settings
                self.on(
                    ACTION.KONATA_CHANGE_COLOR_SCHEME,
                    function (tabID, scheme) {
                        if (!self.activeTab) return;
                        self.config.colorScheme = scheme;
                        self.activeTab.colorScheme = scheme;
                        self.activeTab.renderer.changeColorScheme(scheme);
                        self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                        self.trigger(CHANGE.MENU_UPDATE);
                    },
                );
                self.on(ACTION.KONATA_CHANGE_UI_COLOR_THEME, function (theme) {
                    self.config.theme = theme;
                    if (self.activeTab) self.activeTab.renderer.loadStyle();
                    self.trigger(CHANGE.WINDOW_CSS_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(ACTION.KONATA_CHANGE_SETTINGS, function (key, value) {
                    if (key in self.config.configItems)
                        self.config[key] = value;
                    self.trigger(CHANGE.WINDOW_CSS_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(ACTION.KONATA_SET_DEP_ARROW_TYPE, function (type) {
                    self.config.depArrowType = type;
                    if (self.activeTab)
                        self.activeTab.renderer.depArrowType = type;
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(ACTION.KONATA_SPLIT_LANES, function (enabled) {
                    self.splitLanes = enabled;
                    if (self.activeTab)
                        self.activeTab.renderer.splitLanes = enabled;
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(ACTION.KONATA_FIX_OP_HEIGHT, function (enabled) {
                    self.fixOpHeight = enabled;
                    if (self.activeTab)
                        self.activeTab.renderer.fixOpHeight = enabled;
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(
                    ACTION.KONATA_HIDE_FLUSHED_OPS,
                    function (tabID, enable) {
                        if (!self.activeTab) return;
                        let r = self.activeTab.renderer;
                        let orgOp = r.getOpFromPixelPosY(0);
                        let rid = orgOp ? orgOp.rid : 0;
                        self.activeTab.hideFlushedOps = enable;
                        r.hideFlushedOps = enable;
                        let op = r.getOpFromRID(rid);
                        if (op)
                            r.moveLogicalPos([
                                op.fetchedCycle,
                                enable ? rid : op.id,
                            ]);
                        self.trigger(CHANGE.MENU_UPDATE);
                        self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    },
                );
                self.on(ACTION.KONATA_TRANSPARENT, function (tabID, enable) {
                    if (!self.activeTab) return;
                    self.activeTab.transparent = enable;
                    self.trigger(CHANGE.TAB_UPDATE);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.trigger(CHANGE.MENU_UPDATE);
                });
                self.on(
                    ACTION.KONATA_EMPHASIZE_IN_TRANSPARENT,
                    function (tabID, enable) {
                        if (!self.activeTab) return;
                        self.activeTab.emphasize_in_transparent = enable;
                        self.trigger(CHANGE.TAB_UPDATE);
                        self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                        self.trigger(CHANGE.MENU_UPDATE);
                    },
                );

                // Movement & zoom
                // Immediate drag
                self.on(ACTION.KONATA_MOVE_PIXEL_DIFF, function (diff) {
                    if (!self.activeTab) return;
                    self.activeTab.renderer.movePixelDiff(diff);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });

                // Smooth scroll helpers (RAF-based)
                this.finishScroll = function () {
                    self.scroll.inAnimation = false;
                    if (self.scroll.rafId)
                        cancelAnimationFrame(self.scroll.rafId);
                    self.scroll.rafId = 0;
                    if (!self.activeTab) return;
                    self.activeTab.renderer.moveLogicalPos(self.scroll.endPos);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                };
                this.animateScroll = function () {
                    if (!self.scroll.inAnimation) return;
                    const period = 160; // ms
                    const frames = Math.max(1, period / 16 / self.scroll.speed);
                    self.scroll.curPos[0] += self.scroll.diff[0] / frames;
                    self.scroll.curPos[1] += self.scroll.diff[1] / frames;
                    if (!self.activeTab) return self.finishScroll();
                    self.activeTab.renderer.moveLogicalPos(self.scroll.curPos);
                    const doneX =
                        self.scroll.diff[0] >= 0
                            ? self.scroll.curPos[0] >= self.scroll.endPos[0]
                            : self.scroll.curPos[0] <= self.scroll.endPos[0];
                    const doneY =
                        self.scroll.diff[1] >= 0
                            ? self.scroll.curPos[1] >= self.scroll.endPos[1]
                            : self.scroll.curPos[1] <= self.scroll.endPos[1];
                    if (doneX && doneY) {
                        self.finishScroll();
                        return;
                    }
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                    self.scroll.rafId = requestAnimationFrame(
                        self.animateScroll,
                    );
                };
                this.startScroll = function (diff) {
                    if (!self.activeTab) return;
                    if (self.scroll.inAnimation) {
                        self.finishScroll();
                    }
                    const r = self.activeTab.renderer;
                    const cur = r.viewPos;
                    let targetTop = cur[1] + diff[1];
                    let targetLeft = cur[0] + diff[0];
                    // Align left edge to the first stage (fetchedCycle) of the top-most visible op
                    if (Math.abs(diff[1]) > 0) {
                        const y = Math.floor(targetTop);
                        const op = r.getVisibleOp(y, r.opResolution);
                        if (op) targetLeft = op.fetchedCycle;
                    }
                    r.moveLogicalPos([targetLeft, targetTop]);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                };

                self.on(ACTION.KONATA_MOVE_WHEEL_HORIZONTAL, function (sign) {
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    let dx = (sign * 3) / r.zoomScale;
                    self.startScroll([dx, 0]);
                });
                self.on(
                    ACTION.KONATA_MOVE_WHEEL_VERTICAL,
                    function (sign, adjust) {
                        if (!self.activeTab) return;
                        let r = self.activeTab.renderer;
                        let dy = (sign * 3) / r.zoomScale;
                        let dx = adjust ? r.adjustScrollDiffX(dy) : 0;
                        self.startScroll([dx, dy]);
                    },
                );
                // Smooth zoom helpers
                this.zoomAbs = function (zoomLevel, posX, posY, compensatePos) {
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    r.zoomAbs(zoomLevel, posX, posY, compensatePos);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                };
                this.finishZoom = function () {
                    self.zoom.inAnimation = false;
                    if (self.zoom.rafId) cancelAnimationFrame(self.zoom.rafId);
                    self.zoom.rafId = 0;
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    r.zoomAbs(
                        self.zoom.endLevel,
                        self.zoom.basePoint[0],
                        self.zoom.basePoint[1],
                        self.zoom.compensatePos,
                    );
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                };
                this.animateZoom = function () {
                    if (!self.zoom.inAnimation) return;
                    // ~120ms animation scaled by speed
                    const period = 120;
                    const frames = Math.max(1, period / 16 / self.zoom.speed);
                    self.zoom.curLevel += self.zoom.diff / frames;
                    self.zoomAbs(
                        self.zoom.curLevel,
                        self.zoom.basePoint[0],
                        self.zoom.basePoint[1],
                        self.zoom.compensatePos,
                    );
                    const forward = self.zoom.diff > 0;
                    if (
                        (forward && self.zoom.curLevel >= self.zoom.endLevel) ||
                        (!forward && self.zoom.curLevel <= self.zoom.endLevel)
                    ) {
                        self.finishZoom();
                        return;
                    }
                    self.zoom.rafId = requestAnimationFrame(self.animateZoom);
                };
                this.startZoom = function (
                    zoomLevelDiff,
                    posX,
                    posY,
                    speed = 0.6,
                ) {
                    if (!self.activeTab) return;
                    if (self.zoom.inAnimation) self.finishZoom();
                    self.zoom.diff = zoomLevelDiff;
                    self.zoom.curLevel = self.activeTab.renderer.zoomLevel;
                    self.zoom.endLevel = self.zoom.curLevel + zoomLevelDiff;
                    self.zoom.speed = speed;
                    self.zoom.basePoint = [posX, posY];
                    self.zoom.compensatePos = true;
                    self.zoom.inAnimation = true;
                    self.zoom.rafId = requestAnimationFrame(self.animateZoom);
                };

                self.on(ACTION.KONATA_ZOOM, function (zoomDir, posX, posY) {
                    if (!self.activeTab) return;
                    if (self.zoom.inAnimation) {
                        self.finishZoom();
                    }
                    const r = self.activeTab.renderer;
                    const step = 1 / ((self.config.drawZoomFactor || 1) * 2);
                    const diff = -zoomDir * step; // +1 => zoom in
                    r.zoomAbs(r.zoomLevel + diff, posX, posY, true);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });
                self.on(ACTION.KONATA_MOVE_LABEL_CLICK, function (offsetY) {
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    let op = r.getOpFromPixelPosY(offsetY);
                    if (op) r.moveLogicalPos([op.fetchedCycle, r.viewPos[1]]);
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });

                // Find
                self.on(ACTION.KONATA_FIND_STRING, function (target) {
                    self.findString(
                        target,
                        self.activeTab
                            ? Math.floor(self.activeTab.renderer.viewPos[1])
                            : 0,
                        false,
                        () => {},
                    );
                });
                self.on(ACTION.KONATA_FIND_NEXT_STRING, function () {
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    self.findString(
                        self.activeTab.findContext.targetPattern,
                        Math.floor(r.viewPos[1]),
                        false,
                        () => {},
                    );
                });
                self.on(ACTION.KONATA_FIND_PREV_STRING, function () {
                    if (!self.activeTab) return;
                    let r = self.activeTab.renderer;
                    self.findString(
                        self.activeTab.findContext.targetPattern,
                        Math.floor(r.viewPos[1]),
                        true,
                        () => {},
                    );
                });
                self.on(ACTION.KONATA_FIND_HIDE_RESULT, function () {
                    if (!self.activeTab) return;
                    self.activeTab.findContext.visibility = false;
                    self.trigger(CHANGE.PANE_CONTENT_UPDATE);
                });
            }

            startScroll(diff) {
                if (!this.activeTab) return;
                this.activeTab.renderer.moveLogicalDiff(diff, true);
                this.trigger(CHANGE.PANE_CONTENT_UPDATE);
            }

            makeFindTargetString(op) {
                let labelString = `${op.id}: s${op.gid} (t${op.tid}: r${op.rid}) ${op.labelName}\n${op.labelDetail}`;
                for (let laneName in op.lanes) {
                    for (let stage of op.lanes[laneName].stages) {
                        if (stage.labels != "")
                            labelString += "\n" + stage.labels;
                    }
                }
                return labelString;
            }

            async findString(target, basePos, reverse, resultHandler) {
                if (!this.activeTab) return;
                let tab = this.activeTab;
                tab.findContext.findID++;
                let findID = tab.findContext.findID;
                let konata = tab.konata;
                let targetPattern = new RegExp(target);
                let SLEEP_PERIOD = 1024 * 8;
                let prevSleep = Date.now();
                let start = Date.now();
                let canceled = false;
                let found = false;
                let foundPos = -1;
                let lastOpID = konata.lastID;
                let cur = basePos;
                if (cur < 0 || cur >= lastOpID) cur = 0;
                this.trigger(CHANGE.PROGRESS_BAR_START, tab.id, "search");
                for (let i = 0; i <= lastOpID; i++) {
                    cur += reverse ? -1 : 1;
                    if (cur < 0) cur += lastOpID;
                    else if (cur > lastOpID) cur = 0;
                    let op = konata.getOp(cur);
                    if (
                        op &&
                        targetPattern.exec(this.makeFindTargetString(op))
                    ) {
                        found = true;
                        foundPos = cur;
                        break;
                    }
                    if (i % SLEEP_PERIOD == 0) {
                        let now = Date.now();
                        if (prevSleep + 100 < now) {
                            prevSleep = now;
                            this.trigger(
                                CHANGE.PROGRESS_BAR_UPDATE,
                                i / lastOpID,
                                tab.id,
                                "search",
                            );
                            await new Promise((r) => setTimeout(r, 17));
                            if (findID != tab.findContext.findID) {
                                canceled = true;
                                break;
                            }
                        }
                    }
                }
                console.log(
                    `Search finished: ${target}@${foundPos}, ${Date.now() - start} msec`,
                );
                this.trigger(CHANGE.PROGRESS_BAR_FINISH, tab.id, "search");
                if (!canceled) {
                    tab.findContext.found = false;
                    if (found) {
                        let op = konata.getOp(foundPos);
                        if (op) {
                            let r = tab.renderer;
                            let viewPos = r.viewPos;
                            let moveTo = r.getPosY_FromOp(op);
                            let ctx = tab.findContext;
                            ctx.found = true;
                            ctx.visibility = true;
                            ctx.targetPattern = target;
                            ctx.foundStr = this.makeFindTargetString(op);
                            ctx.op = op;
                            ctx.flushed = op.flush;
                            this.startScroll([
                                op.fetchedCycle - viewPos[0],
                                moveTo - viewPos[1],
                            ]);
                        }
                    }
                    this.trigger(CHANGE.PANE_CONTENT_UPDATE);
                }
            }
        }

        module.exports = { Store, ACTION, CHANGE };
    });
})();
