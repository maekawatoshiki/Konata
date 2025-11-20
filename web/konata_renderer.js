// Ported as-is; uses theme JSON via require(fileName)
let Konata = require("./konata").Konata;
let Config = require("./config").Config;
let Op = require("./op").Op;
let Stage = require("./stage").Stage;

let DEP_ARROW_TYPE = {
    INSIDE_LINE: "insideLine",
    LEFT_SIDE_CURVE: "leftSideCurve",
    NOT_SHOW: "notShow",
};

class KonataRenderer {
    constructor() {
        this.name = "KonataRenderer";
        this.viewPos_ = { left: 0, top: 0 };
        this.depArrowType_ = DEP_ARROW_TYPE.INSIDE_LINE;
        this.ZOOM_RATIO_ = 1;
        /** @type {Konata} */ this.konata_ = null;
        /** @type {Config} */ this.config = null;
        this.colorScheme_ = "RSD";
        this.OP_W = 32;
        this.OP_H = 24;
        this.MAX_ZOOM_LEVEL_ = 24;
        this.MIN_ZOOM_LEVEL_ = -1;
        this.zoomLevel_ = 0;
        this.zoomScale_ = 1;
        this.laneNum_ = 1;
        this.laneW_ = this.OP_W;
        this.laneH_ = this.OP_H;
        this.opW_ = this.OP_W;
        this.opH_ = this.OP_H;
        this.LANE_HEIGHT_MARGIN = 2;
        this.lane_height_margin_ = this.LANE_HEIGHT_MARGIN;
        this.splitLanes_ = false;
        this.fixOpHeight_ = false;
        this.hideFlushedOps_ = false;
        this.PIXEL_ADJUST = 0.5;
        this.drawingInterval_ = 1;
        this.labelFont_ = "";
        this.stageFont_ = "";
        this.labelFontSize_ = 12;
        this.stageFontSize_ = 12;
        this.style_ = null;
    }
    get opW() {
        return this.opW_;
    }
    get opH() {
        return this.opH_;
    }
    get viewPos() {
        return [this.viewPos_.left, this.viewPos_.top];
    }
    get opResolution() {
        return this.zoomLevel_ - 5;
    }
    init(konata, config) {
        this.konata_ = konata;
        this.config = config;
        this.loadStyle();
        this.viewPos_ = { left: 0, top: 0 };
        this.zoomLevel_ = 0;
        this.zoomScale_ = this.calcScale_(this.zoomLevel_);
        this.depArrowType = config.depArrowType;
        this.changeColorScheme(config.colorScheme);
        this.updateScaleParameter();
    }
    get hideFlushedOps() {
        return this.hideFlushedOps_;
    }
    set hideFlushedOps(v) {
        this.hideFlushedOps_ = !!v;
    }
    loadStyle() {
        let fileName = this.config.THEME_STYLE_LIST[this.config.theme];
        this.style_ = require(fileName);
        let colorStyle = this.style_.pipelinePane.stageBackgroundColor;
        for (let i of ["lBegin", "sBegin", "lEnd", "sEnd"])
            colorStyle[i] = Number(colorStyle[i]);
    }
    getStageColor_(laneName, stageName, isBegin, op) {
        let self = this;
        if (self.colorScheme_ == "Auto" || self.colorScheme_ == "Unique") {
            if (stageName == "f" || stageName == "stl") {
                return this.style_.pipelinePane.stallBackgroundColor;
            }
            let stageLevel = self.konata_.stageLevelMap.get(
                laneName,
                stageName,
            );
            let laneID = self.konata_.stageLevelMap.getLaneID(laneName);
            let level =
                self.colorScheme_ == "Auto"
                    ? stageLevel.appearance
                    : stageLevel.unique;
            let color = this.style_.pipelinePane.stageBackgroundColor;
            if (isBegin) {
                let h =
                    (250 - level * color.hRateBegin + laneID * 28 * 8) % 360;
                return `hsl(${h},${color.sBegin}%,${color.lBegin}%)`;
            } else {
                let h = (250 - level * color.hRateEnd + laneID * 28 * 8) % 360;
                return `hsl(${h},${color.sEnd}%,${color.lEnd}%)`;
            }
        } else if (self.colorScheme_ == "ThreadID") {
            let stageLevel = self.konata_.stageLevelMap.get(
                laneName,
                stageName,
            );
            let level = op.tid;
            let color = this.style_.pipelinePane.stageBackgroundColor;
            if (isBegin) {
                let h = (250 - level * color.hRateBegin) % 360;
                let s = color.sBegin;
                let l =
                    (1000 +
                        color.lBegin +
                        (color.lBegin > 50 ? -1 : 1) *
                            stageLevel.appearance *
                            4) %
                    100;
                return `hsl(${h},${s}%,${l}%)`;
            } else {
                let h = (250 - level * color.hRateEnd) % 360;
                let s = color.sEnd;
                let l =
                    (1000 +
                        color.lEnd +
                        (color.lEnd > 50 ? -1 : 1) *
                            stageLevel.appearance *
                            4) %
                    100;
                return `hsl(${h},${s}%,${l}%)`;
            }
        } else if (self.colorScheme_ in self.config.customColorSchemes) {
            let style = self.config.customColorSchemes[self.colorScheme_];
            let colorDef = style["defaultColor"];
            if (laneName in style) {
                if (stageName in style[laneName]) {
                    colorDef = style[laneName][stageName];
                }
            }
            let baseColor = this.style_.pipelinePane.stageBackgroundColor;
            let h = colorDef.h;
            let s = colorDef.s;
            let l = colorDef.l;
            if (isBegin) {
                l = l == "auto" ? baseColor.lBegin : l;
                s = s == "auto" ? baseColor.sBegin : s;
            } else {
                l = l == "auto" ? baseColor.lEnd : l;
                s = s == "auto" ? baseColor.sEnd : s;
            }
            if (
                typeof s == "number" ||
                (typeof s == "string" && s.match(/^\d+$/))
            ) {
                s += "%";
            }
            if (
                typeof l == "number" ||
                (typeof l == "string" && l.match(/^\d+$/))
            ) {
                l += "%";
            }
            return `hsl(${h},${s},${l})`;
        }
        return self.colorScheme_;
    }
    changeColorScheme(s) {
        this.colorScheme_ = s;
    }
    get depArrowType() {
        return this.depArrowType_;
    }
    set depArrowType(t) {
        this.depArrowType_ = t;
    }
    moveWheel(wheelUp) {
        let self = this;
        let scroll = 3 / self.zoomScale_;
        self.moveLogicalDiff([0, wheelUp ? scroll : -scroll], true);
    }
    movePixelDiff(diff) {
        let self = this;
        self.moveLogicalDiff([diff[0] / self.opW_, diff[1] / self.opH_], false);
    }
    adjustScrollDiffX(diffY) {
        let self = this;
        let posY = self.viewPos_.top;
        let y = Math.floor(posY);
        if (y < 0 || y > self.getVisibleBottom()) {
            return 0;
        }

        // 画面に表示されているものの中で最も上にあるものを基準に
        let oldOp = null;
        oldOp = self.getVisibleOp(y, this.opResolution);

        // 水平方向の補正を行う
        let newTop = y + diffY;
        let newY = Math.floor(newTop);
        let newOp = self.getVisibleOp(newY, this.opResolution);

        if (!newOp) {
            return 0;
        } else if (!oldOp || newOp.id == oldOp.id) {
            let left = self.viewPos_.left;
            return newOp.fetchedCycle - left;
        } else {
            // スクロール前と後の，左上の命令の水平方向の差を加算
            return newOp.fetchedCycle - oldOp.fetchedCycle;
        }
    }
    moveLogicalDiff(diff, adjust) {
        let self = this;
        let posY = self.viewPos_.top + diff[1];
        let y = Math.floor(posY);
        let op = self.getVisibleOp(y, this.opResolution);
        let oldTop = self.viewPos_.top;
        self.viewPos_.top = posY;
        if (adjust && op) {
            let oldOp = self.getVisibleOp(
                Math.floor(oldTop),
                this.opResolution,
            );
            if (!oldOp) {
                self.viewPos_.left = op.fetchedCycle;
            } else {
                self.viewPos_.left += op.fetchedCycle - oldOp.fetchedCycle;
            }
        } else {
            self.viewPos_.left += diff[0];
        }
    }
    moveLogicalPos(pos) {
        this.viewPos_.left = pos[0];
        this.viewPos_.top = pos[1];
    }
    getVisibleOp(y, resolution = 0) {
        return this.hideFlushedOps_
            ? this.getOpFromRID(y, resolution)
            : this.getOpFromID(y, resolution);
    }
    getVisibleBottom() {
        return this.hideFlushedOps_
            ? this.konata_.lastRID
            : this.konata_.lastID;
    }
    getPosY_FromRID(rid) {
        if (this.hideFlushedOps_) {
            return rid;
        } else {
            let op = this.getOpFromRID(rid);
            return op ? op.id : -1;
        }
    }
    getPosY_FromOp(baseOP) {
        if (this.hideFlushedOps_) {
            for (let i = baseOP.id; i >= 0; i--) {
                let op = this.getOpFromID(i);
                if (!op.flush) return op.rid;
            }
            return 0;
        } else {
            return baseOP.id;
        }
    }
    getOpFromID(id, resolution = 0) {
        return this.konata_.getOp(id, resolution);
    }
    getOpFromRID(rid, resolution = 0) {
        return this.konata_.getOpFromRID(rid, resolution);
    }
    getOpFromPixelPosY(y, resolution = 0) {
        let self = this;
        let logY = Math.floor(self.viewPos_.top + y / self.opH_);
        return self.getVisibleOp(logY, resolution);
    }
    getPixelPosYFromOp(op) {
        let self = this;
        return (
            ((this.hideFlushedOps_ ? op.rid : op.id) - self.viewPos_.top) *
            self.opH_
        );
    }
    getCycleFromPixelPosX(x) {
        let self = this;
        return Math.floor(self.viewPos_.left + x / self.opW_);
    }
    getLabelToolTipText(y) {
        let self = this;
        let op = self.getOpFromPixelPosY(y, this.opResolution);
        if (!op) return null;
        let text =
            `${op.labelName}\n${op.labelDetail}\n` +
            `Line:\t\t${op.line}\n` +
            `Serial ID:\t${op.gid}\n` +
            `Thread ID:\t\t${op.tid}\n` +
            `Retire ID:\t\t${op.rid}`;
        if (op.flush) text += "\n# This op is flushed.";
        return text;
    }
    getPipelineToolTipText(x, y) {
        let self = this;
        let op = self.getOpFromPixelPosY(y, this.opResolution);
        if (!op) return null;
        let cycle = this.getCycleFromPixelPosX(x);
        let text = `[${cycle}, ${op.id}] `;
        if (cycle < op.fetchedCycle || cycle > op.retiredCycle) return text;
        let stageText = "";
        let first = true;
        for (let laneName in op.lanes) {
            for (let stage of op.lanes[laneName].stages) {
                let start = stage.startCycle;
                let end = stage.endCycle;
                let length = end - start;
                if (length == 0) end += 1;
                if (start <= cycle && cycle < end) {
                    if (!first) text += ", ";
                    text += `${stage.name}[${stage.endCycle - stage.startCycle}]`;
                    if (stage.labels != "") {
                        for (let line of stage.labels.split("\n")) {
                            if (line != "")
                                stageText += `${stage.name}: ${line}\n`;
                        }
                    }
                    first = false;
                }
            }
        }
        return stageText == "" ? text : text + "\n" + stageText;
    }
    drawLabel(canvas) {
        let self = this;
        // Use fractional top for smooth label scrolling
        let top = self.viewPos_.top;
        self.drawLabelTile_(canvas, top);
    }
    drawLabelTile_(tile, logTop) {
        let self = this;
        let ctx = tile.getContext("2d");
        let width = tile.clientWidth;
        let height = tile.clientHeight;
        ctx.clearRect(0, 0, width, height);
        // Background
        ctx.fillStyle = self.style_.labelPane.backgroundColor;
        ctx.fillRect(0, 0, width, height);
        // If zoomed out too far, skip expensive text rendering to keep perf
        if (!self.canDrawText) {
            return;
        }
        // Text
        ctx.font = self.labelFont_;
        ctx.fillStyle = self.style_.labelPane.fontColor;
        let lineH = self.opH_;
        // Compute integer base and fractional offset
        let baseTop = Math.floor(logTop);
        let frac = logTop - baseTop;
        let maxY = Math.ceil(height / lineH) + 1;
        for (let i = 0; i < maxY; i++) {
            let op = self.getVisibleOp(baseTop + i, this.opResolution);
            if (!op) continue;
            let text = op.labelName;
            let py = (i - frac + 1) * lineH - lineH / 4;
            ctx.fillText(text, Number(self.style_.labelPane.marginLeft), py);
        }
    }
    drawPipeline(canvas) {
        let self = this;
        // Use fractional view position to allow smooth scrolling
        let top = self.viewPos_.top;
        let left = self.viewPos_.left;
        self.drawPipelineTile_(canvas, top, left);
    }
    updateScaleParameter() {
        let self = this;
        let zoomScale = self.zoomScale_;
        self.laneNum_ = self.konata_.stageLevelMap.laneNum;
        self.laneW_ = self.OP_W * zoomScale;
        if (self.splitLanes_ && self.fixOpHeight_) {
            self.laneH_ = (self.OP_H * zoomScale) / self.laneNum_;
        } else {
            self.laneH_ = self.OP_H * zoomScale;
        }
        self.opW_ = self.laneW_ * 1;
        self.opH_ = self.laneH_ * 1;
        self.lane_height_margin_ = self.canDrawFrame
            ? self.LANE_HEIGHT_MARGIN * zoomScale
            : 0;
        self.drawingInterval_ = Math.floor(1 / self.OP_H / zoomScale / 2);
        let fontSize = Number(self.style_.fontSize);
        let fontFamily = self.style_.fontFamily;
        let fontStyle = self.style_.fontStyle;
        self.labelFont_ = `${fontStyle} ${fontSize * Math.min(1.0, zoomScale)}px ${fontFamily}`;
        self.stageFont_ = `${fontStyle} ${fontSize * zoomScale}px ${fontFamily}`;
        self.labelFontSize_ = fontSize * Math.min(1.0, zoomScale);
        self.stageFontSize_ = fontSize * zoomScale;
    }
    get zoomLevel() {
        return this.zoomLevel_;
    }
    get zoomScale() {
        return this.zoomScale_;
    }
    calcScale_(level) {
        return Math.pow(2, -level * this.ZOOM_RATIO_);
    }
    zoomAbs(zoomLevel, posX, posY, compensatePos = true) {
        let self = this;
        self.zoomLevel_ = zoomLevel;
        self.zoomLevel_ = Math.max(
            Math.min(self.zoomLevel_, self.MAX_ZOOM_LEVEL_),
            self.MIN_ZOOM_LEVEL_,
        );
        // Keep old values to compute precise compensation around cursor position
        let oldScale = self.zoomScale_;
        let oldLeft = self.viewPos_.left;
        let oldTop = self.viewPos_.top;
        self.zoomScale_ = self.calcScale_(self.zoomLevel_);
        if (compensatePos) {
            const opW_old = self.OP_W * oldScale;
            const opH_old = self.OP_H * oldScale;
            const opW_new = self.OP_W * self.zoomScale_;
            const opH_new = self.OP_H * self.zoomScale_;
            const newLeft = oldLeft + posX / opW_old - posX / opW_new;
            const newTop = oldTop + posY / opH_old - posY / opH_new;
            self.moveLogicalPos([newLeft, newTop]);
        }
        self.updateScaleParameter();
    }
    zoom(zoomLevelDiff, posX, posY) {
        let self = this;
        self.zoomAbs(self.zoomLevel + zoomLevelDiff, posX, posY);
    }
    drawPipelineTile_(tile, top, left) {
        let self = this;
        let scale = self.zoomScale_;
        let height = tile.clientHeight / self.opH_;
        let width = tile.clientWidth / self.opW_;

        let ctx = tile.getContext("2d");
        ctx.fillStyle = self.style_.pipelinePane.backgroundColor;
        ctx.fillRect(0, 0, tile.clientWidth, tile.clientHeight);

        // 上側にはみ出ていた場合，暗く描画
        let offsetY = 0;
        // Use dynamic pixel-adjust only when aligned to integer logical coords to avoid shimmering
        const fracTop = top - Math.floor(top);
        const fracLeft = left - Math.floor(left);
        const pxAdj = fracTop === 0 && fracLeft === 0 ? self.PIXEL_ADJUST : 0;
        if (top < 0) {
            let bottom = -top * self.opH_ + pxAdj;
            bottom = Math.min(tile.clientHeight, bottom);
            ctx.fillStyle =
                self.style_.pipelinePane.invalidBackgroundColor ||
                "rgba(0,0,0,0.1)";
            ctx.fillRect(0, 0, tile.clientWidth, bottom);
            if (bottom >= tile.clientHeight) {
                return;
            }
            offsetY = -top;
            top = 0;
        }

        // タイルの描画
        let skipRendering = false;
        for (
            let y = Math.floor(top);
            y < top + height;
            y += this.opH_ < 0.25 ? self.drawingInterval_ : 1
        ) {
            // 背景をストライプに（論理位置が整数境界に揃っている時のみ描画してチラつきを抑制）
            let pixelY = y - top + offsetY;
            if (self.canDrawFrame && fracTop === 0) {
                if (y % 2 == 0) {
                    let fillTop = pixelY * this.opH_ + pxAdj;
                    ctx.fillStyle =
                        this.style_.pipelinePane.backgroundColorStripeOverlay ||
                        "rgba(245,245,245,0.5)";
                    ctx.fillRect(0, fillTop, tile.clientWidth, this.opH_);
                }
            }
            if (skipRendering) {
                continue;
            }

            let op = null;
            try {
                op = self.getVisibleOp(y, this.opResolution);
            } catch (e) {
                console.log(e);
                return;
            }
            if (op == null) {
                // Since id can not be contiguous in gem5, there can be valid ops
                // after null.
                continue;
            }
            if (this.hideFlushedOps_ && op.flush) {
                continue;
            }

            if (
                !self.drawOp_(
                    op,
                    y - top + offsetY,
                    left,
                    left + width,
                    scale,
                    ctx,
                )
            ) {
                skipRendering = true;
            }
        }

        // 依存関係
        if (self.depArrowType_ != "notShow") {
            self.drawDependency(offsetY, top, left, width, height, ctx);
        }

        // 下側にはみ出ていた場合，暗く描画
        let getVisibleBottom = () =>
            self.hideFlushedOps_ ? self.konata_.lastRID : self.konata_.lastID;
        let bottomOuterHeight = top - offsetY + height - 1 - getVisibleBottom();
        if (bottomOuterHeight > 0) {
            let begin =
                tile.clientHeight - bottomOuterHeight * self.opH_ + pxAdj;
            begin = Math.max(0, begin);
            ctx.fillStyle =
                self.style_.pipelinePane.invalidBackgroundColor ||
                "rgba(0,0,0,0.1)";
            ctx.fillRect(0, begin, tile.clientWidth, tile.clientHeight);
        }
    }
    drawDependency(logOffsetY, logTop, logLeft, logWidth, logHeight, ctx) {
        // 依存関係の描画
        let self = this;
        if (!self.canDrawDependency) return;

        // Arrow geometry settings
        let arrowBeginOffsetX = (self.opW_ * 3) / 4 + self.PIXEL_ADJUST;
        let arrowEndOffsetX = (self.opW_ * 1) / 4 + self.PIXEL_ADJUST;
        let arrowMidOffsetY = self.laneH_ / 2 + self.PIXEL_ADJUST;
        let arrowBeginOffsetY = (self.laneH_ * 2) / 3 + self.PIXEL_ADJUST;
        let arrowEndOffsetY = (self.laneH_ * 1) / 3 + self.PIXEL_ADJUST;

        let arrowWeight = Number(this.style_.pipelinePane.arrowWeight);
        ctx.lineWidth = arrowWeight;
        ctx.strokeStyle = this.style_.pipelinePane.arrowColor;
        ctx.fillStyle = this.style_.pipelinePane.arrowColor;

        const viewStartCycle = Math.floor(logLeft);
        const viewEndCycle = Math.ceil(logLeft + logWidth);
        for (let y = Math.floor(logTop); y < logTop + logHeight; y++) {
            let op = self.getVisibleOp(y);
            if (!op) continue;

            let consCycle = op.consCycle;
            if (consCycle === -1) continue;

            for (let dep of op.prods) {
                let prod = this.getOpFromID(dep.opID); // producer op (not visible-op API)
                if (!prod) continue;
                if (this.hideFlushedOps_ && prod.flush) continue; // skip flushed when hidden

                let prodCycle = prod.prodCycle;
                if (prodCycle === -1) continue;

                // Cull arrows completely outside the horizontal viewport
                if (prodCycle < viewStartCycle && consCycle < viewStartCycle)
                    continue;
                if (prodCycle > viewEndCycle && consCycle > viewEndCycle)
                    continue;

                // y-position depending on hideFlushedOps
                let yProd = this.hideFlushedOps_ ? prod.rid : prod.id;

                if (self.depArrowType_ === DEP_ARROW_TYPE.INSIDE_LINE) {
                    let xBegin =
                        (prodCycle - logLeft) * self.opW_ + arrowBeginOffsetX;
                    let yBegin =
                        (yProd - logTop + logOffsetY) * self.opH_ +
                        arrowMidOffsetY;
                    // End at the consumer's consume cycle, not the dep event cycle
                    let xEnd =
                        (consCycle - logLeft) * self.opW_ + arrowEndOffsetX;
                    let yEnd =
                        (y - logTop + logOffsetY) * self.opH_ + arrowMidOffsetY;

                    self.drawArrow_(
                        ctx,
                        [xBegin, yBegin],
                        [xEnd, yEnd],
                        [xEnd - xBegin, yEnd - yBegin],
                        arrowWeight,
                    );
                } else {
                    // LEFT_SIDE_CURVE
                    let xBegin = (prod.fetchedCycle - logLeft) * self.opW_;
                    let yBegin =
                        (yProd - logTop + logOffsetY) * self.opH_ +
                        arrowBeginOffsetY;
                    let xEnd = (op.fetchedCycle - logLeft) * self.opW_;
                    let yEnd =
                        (y - logTop + logOffsetY) * self.opH_ + arrowEndOffsetY;

                    self.drawArrow_(
                        ctx,
                        [xBegin, yBegin],
                        [xEnd, yEnd],
                        [1, 0],
                        arrowWeight,
                    );
                }
            }
        }
    }

    // 矢印を描画する
    // start/end: [x,y], v: direction vector for head orientation, size: scale
    drawArrow_(ctx, start, end, v, size) {
        let self = this;
        if (self.depArrowType_ == DEP_ARROW_TYPE.INSIDE_LINE) {
            // Straight line inside pipeline
            ctx.beginPath();
            ctx.moveTo(start[0], start[1]);
            ctx.lineTo(end[0], end[1]);
            ctx.stroke();
        } else {
            // Left-side bezier curve
            let offsetX =
                start[0] -
                self.opW_ *
                    Math.sqrt(
                        Math.max(
                            0,
                            (end[1] - start[1]) / Math.max(1e-6, self.opH_),
                        ),
                    );
            ctx.beginPath();
            ctx.moveTo(start[0], start[1]);
            ctx.bezierCurveTo(
                offsetX,
                start[1],
                offsetX,
                end[1],
                end[0],
                end[1],
            );
            ctx.stroke();
        }

        // Arrow head
        let shape = 0.8;
        let norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]) || 1;
        let f = (size * 5) / norm; // 5: head size
        let vx = v[0] * f;
        let vy = v[1] * f;

        let p0 = end;
        let p1 = [
            end[0] - vx - vy * 0.5 * shape,
            end[1] - vy + vx * 0.5 * shape,
        ];
        let p2 = [
            end[0] - vx + vy * 0.5 * shape,
            end[1] - vy - vx * 0.5 * shape,
        ];
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.fill();
    }
    get canDrawDetailedly() {
        let laneHeight = this.laneH_ - this.lane_height_margin_ * 2;
        return laneHeight > this.config.drawDetailedlyThreshold;
    }
    get canDrawDependency() {
        let laneHeight = this.laneH_ - this.lane_height_margin_ * 2;
        return laneHeight > this.config.drawDependencyThreshold;
    }
    get canDrawFrame() {
        let laneHeight = this.laneH_ - this.lane_height_margin_ * 2;
        return laneHeight > this.config.drawFrameThreshold;
    }
    get canDrawText() {
        let laneHeight = this.laneH_ - this.lane_height_margin_ * 2;
        return laneHeight > this.config.drawTextThreshold;
    }

    /**
     * @param {string} laneName
     * @param {string} stageName
     * @param {boolean} isBegin
     * @param {Op} op
     */
    getStageColor_(laneName, stageName, isBegin, op) {
        let self = this;

        if (self.colorScheme_ == "Auto" || self.colorScheme_ == "Unique") {
            if (stageName == "f" || stageName == "stl") {
                return this.style_.pipelinePane.stallBackgroundColor;
            }
            let stageLevel = self.konata_.stageLevelMap.get(
                laneName,
                stageName,
            );
            let laneID = self.konata_.stageLevelMap.getLaneID(laneName);

            let level =
                self.colorScheme_ == "Auto"
                    ? stageLevel.appearance
                    : stageLevel.unique;
            let color = this.style_.pipelinePane.stageBackgroundColor;
            if (isBegin) {
                let h =
                    (250 - level * color.hRateBegin + laneID * 28 * 8) % 360;
                return `hsl(${h},${color.sBegin}%,${color.lBegin}%)`;
            } else {
                let h = (250 - level * color.hRateEnd + laneID * 28 * 8) % 360;
                return `hsl(${h},${color.sEnd}%,${color.lEnd}%)`;
            }
        } else if (self.colorScheme_ == "ThreadID") {
            let stageLevel = self.konata_.stageLevelMap.get(
                laneName,
                stageName,
            );
            let level = op.tid;
            let color = this.style_.pipelinePane.stageBackgroundColor;
            if (isBegin) {
                let h = (250 - level * color.hRateBegin) % 360;
                let s = color.sBegin;
                // A gradation direction is changed depending on the light/dark mode.
                // if color.lBegin > 50, it is assumed the light mode
                let l =
                    (1000 +
                        color.lBegin +
                        (color.lBegin > 50 ? -1 : 1) *
                            stageLevel.appearance *
                            4) %
                    100;
                return `hsl(${h},${s}%,${l}%)`;
            } else {
                let h = (250 - level * color.hRateEnd) % 360;
                let s = color.sEnd;
                let l =
                    (1000 +
                        color.lEnd +
                        (color.lEnd > 50 ? -1 : 1) *
                            stageLevel.appearance *
                            4) %
                    100;
                return `hsl(${h},${s}%,${l}%)`;
            }
        } else if (self.colorScheme_ in self.config.customColorSchemes) {
            let style = self.config.customColorSchemes[self.colorScheme_];
            let colorDef = style["defaultColor"];
            if (laneName in style) {
                if (stageName in style[laneName]) {
                    colorDef = style[laneName][stageName];
                }
            }
            let baseColor = this.style_.pipelinePane.stageBackgroundColor;
            let h = colorDef.h;
            let s = colorDef.s;
            let l = colorDef.l;
            if (isBegin) {
                l = l == "auto" ? baseColor.lBegin : l;
                s = s == "auto" ? baseColor.sBegin : s;
            } else {
                l = l == "auto" ? baseColor.lEnd : l;
                s = s == "auto" ? baseColor.sEnd : s;
            }
            if (
                typeof s == "number" ||
                (typeof s == "string" && s.match(/^\d+$/))
            ) {
                s += "%";
            }
            if (
                typeof l == "number" ||
                (typeof l == "string" && l.match(/^\d+$/))
            ) {
                l += "%";
            }
            return `hsl(${h},${s},${l})`;
        }
        return self.colorScheme_;
    }

    drawLane_(op, h, startCycle, endCycle, scale, ctx, laneName) {
        let self = this;

        let fontSizeRaw = self.stageFontSize_;
        ctx.font = self.stageFont_;

        let lane = op.lanes[laneName].stages;
        let top = h * self.opH_ + self.PIXEL_ADJUST;
        for (let i = 0, len = lane.length; i < len; i++) {
            let stage = lane[i];
            if (stage.endCycle == 0) {
                stage.endCycle = op.retiredCycle;
            }
            if (stage.endCycle < startCycle) {
                continue;
            } else if (endCycle < stage.startCycle) {
                break; // stage.startCycle が endCycleを超えているなら，以降のステージはこのcanvasに描画されない．
            }
            if (stage.endCycle == stage.startCycle) {
                continue;
            }

            let logLeft =
                Math.max(startCycle - 1, stage.startCycle) - startCycle;
            let logRight = Math.min(endCycle + 1, stage.endCycle) - startCycle;

            let left = logLeft * self.opW_ + self.PIXEL_ADJUST;
            let right = logRight * self.opW_ + self.PIXEL_ADJUST;
            let rect = [
                left,
                top + self.lane_height_margin_,
                right - left,
                self.laneH_ - self.lane_height_margin_ * 2,
            ];

            let grad = ctx.createLinearGradient(0, top, 0, top + self.laneH_);
            grad.addColorStop(
                0,
                self.getStageColor_(laneName, stage.name, true, op),
            );
            grad.addColorStop(
                1,
                self.getStageColor_(laneName, stage.name, false, op),
            );

            ctx.fillStyle = grad;
            ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);

            if (self.canDrawFrame) {
                ctx.lineWidth = this.style_.pipelinePane.borderWeight;
                ctx.strokeRect(rect[0], rect[1], rect[2], rect[3]);
            }

            if (self.canDrawText) {
                ctx.fillStyle = self.style_.pipelinePane.fontColor;
                let textTop =
                    top +
                    (self.laneH_ - self.lane_height_margin_ * 2 - fontSizeRaw) /
                        2 +
                    fontSizeRaw;
                let textLeft = (stage.startCycle - startCycle) * self.opW_;
                for (
                    let j = 1, len_in = stage.endCycle - stage.startCycle;
                    j < len_in;
                    j++
                ) {
                    if (j + stage.startCycle > endCycle) {
                        // プロセッサのバグなどが原因で非常に長いステージが生成された場合に
                        // fillText が呼ばれ続けて重くなるため描画を打ち切る
                        break;
                    }
                    let margin = Math.max(
                        0,
                        (self.opW_ - (String(j).length * fontSizeRaw) / 2) / 2,
                    );
                    ctx.fillText(j, textLeft + j * self.opW_ + margin, textTop);
                }
                let margin = Math.max(
                    0,
                    (self.opW_ - (stage.name.length * fontSizeRaw) / 2) / 2,
                );
                ctx.fillText(stage.name, textLeft + margin, textTop);
            }

            if (op.flush) {
                let bgc = this.style_.pipelinePane.flushedRegionColor;
                ctx.fillStyle = bgc;
                ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
            }
        }
    }

    /**
     * @param {Op} op
     * @param {number} h
     * @param {number} startCycle
     * @param {number} endCycle
     * @param {number} scale
     * @param {*} ctx
     */
    drawOp_(op, h, startCycle, endCycle, scale, ctx) {
        let self = this;
        let top = h * self.opH_ + self.PIXEL_ADJUST;

        if (op.retiredCycle < startCycle) {
            return true;
        } else if (endCycle < op.fetchedCycle) {
            return false;
        }
        if (op.retiredCycle == op.fetchedCycle) {
            return true;
        }
        let l = startCycle > op.fetchedCycle ? startCycle - 1 : op.fetchedCycle;
        l -= startCycle;
        let r = endCycle >= op.retiredCycle ? op.retiredCycle : endCycle + 1;
        r -= startCycle;
        let left = l * self.opW_ + self.PIXEL_ADJUST;
        let right = r * self.opW_ + self.PIXEL_ADJUST;

        let stageLevelMap = this.konata_.stageLevelMap;
        let laneNum = stageLevelMap.laneNum;

        if (self.canDrawDetailedly) {
            // 枠内に表示の余地がある場合
            ctx.strokeStyle = this.style_.pipelinePane.borderColor;

            for (let laneName in op.lanes) {
                let laneTop = self.splitLanes_
                    ? h + stageLevelMap.getLaneID(laneName) / laneNum
                    : h; // logical pos
                self.drawLane_(
                    op,
                    laneTop,
                    startCycle,
                    endCycle,
                    scale,
                    ctx,
                    laneName,
                );
            }
        } else {
            // 十分小さい場合は簡略化モード
            if (
                self.colorScheme_ != "Auto" &&
                self.colorScheme_ != "Unique" &&
                self.colorScheme_ != "ThreadID" &&
                !(self.colorScheme_ in self.config.customColorSchemes)
            ) {
                ctx.fillStyle = self.colorScheme_;
            } else {
                ctx.fillStyle = "#888888";
            }

            // 表示位置の計算
            let laneHeight = self.laneH_ - self.lane_height_margin_ * 2;
            let laneTop = top + self.lane_height_margin_;

            // 縮小率が高すぎると表示が小さくなりすぎて何も見えなくなるので，
            // 最低1ピクセルは表示するように補正
            if (right - left < 1) {
                right = left + 1;
            }
            if (laneHeight < 0.5) {
                laneHeight = 0.5;
            }

            ctx.fillRect(left, laneTop, right - left, laneHeight);

            if (op.flush) {
                let bgc = this.style_.pipelinePane.flushedRegionColor; // 黒の半透明をかぶせる
                ctx.fillStyle = bgc;
                ctx.fillRect(left, laneTop, right - left, laneHeight);
            }
        }
        return true;
    }
}

module.exports.KonataRenderer = KonataRenderer;
module.exports.DEP_ARROW_TYPE = DEP_ARROW_TYPE;
