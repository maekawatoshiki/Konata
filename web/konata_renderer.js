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
        this.MIN_ZOOM_LEVEL_ = -10;
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
        if (y < 0 || y > self.getVisibleBottom()) return 0;
        let oldOp = self.getVisibleOp(y, this.opResolution);
        let newTop = y + diffY;
        let newY = Math.floor(newTop);
        let newOp = self.getVisibleOp(newY, this.opResolution);
        if (!newOp) return 0;
        else if (!oldOp || newOp.id == oldOp.id) {
            let left = self.viewPos_.left;
            return newOp.fetchedCycle - left;
        } else {
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
        let top = Math.floor(self.viewPos_.top);
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
        let maxY = Math.ceil(height / lineH);
        for (let i = 0; i < maxY; i++) {
            let op = self.getVisibleOp(logTop + i, this.opResolution);
            if (!op) continue;
            let text = op.labelName;
            let py = (i + 1) * lineH - lineH / 4;
            ctx.fillText(text, Number(self.style_.labelPane.marginLeft), py);
        }
    }
    drawPipeline(canvas) {
        let self = this;
        let top = Math.floor(self.viewPos_.top);
        let left = Math.floor(self.viewPos_.left);
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
        return Math.pow(2, level * this.ZOOM_RATIO_);
    }
    zoomAbs(zoomLevel, posX, posY, compensatePos = true) {
        let self = this;
        self.zoomLevel_ = zoomLevel;
        self.zoomLevel_ = Math.max(
            Math.min(self.zoomLevel_, self.MAX_ZOOM_LEVEL_),
            self.MIN_ZOOM_LEVEL_,
        );
        let oldScale = self.zoomScale_;
        self.zoomScale_ = self.calcScale_(self.zoomLevel_);
        if (compensatePos) {
            let oldLeft = self.viewPos_.left;
            let oldTop = self.viewPos_.top;
            let ratio = oldScale / self.zoomScale_;
            self.moveLogicalPos([
                oldLeft + (posX / self.opW_) * (1 - ratio),
                oldTop + (posY / self.opH_) * (1 - ratio),
            ]);
        }
        self.updateScaleParameter();
    }
    zoom(zoomLevelDiff, posX, posY) {
        let self = this;
        self.zoomAbs(self.zoomLevel + zoomLevelDiff, posX, posY);
    }
    drawPipelineTile_(tile, top, left) {
        let self = this;
        let ctx = tile.getContext("2d");
        let width = tile.clientWidth;
        let height = tile.clientHeight;
        ctx.clearRect(0, 0, width, height);
        // Pipeline background
        ctx.fillStyle = self.style_.pipelinePane.backgroundColor;
        ctx.fillRect(0, 0, width, height);
        // Optional stripe overlay for readability (very light)
        if (self.style_.pipelinePane.backgroundColorStripeOverlay) {
            ctx.fillStyle =
                self.style_.pipelinePane.backgroundColorStripeOverlay;
            let stripeStep = Math.max(1, self.opH_ * 2);
            let stripeH = Math.max(1, self.opH_);
            for (let y = 0; y < height; y += stripeStep) {
                ctx.fillRect(0, y, width, stripeH);
            }
        }
        ctx.save();
        ctx.font = self.stageFont_;
        ctx.textBaseline = "alphabetic";
        let maxY = Math.ceil(height / self.opH_);
        for (let y = 0; y < maxY; y++) {
            let op = self.getVisibleOp(top + y, this.opResolution);
            if (!op) continue;
            let py = y * self.opH_ + self.PIXEL_ADJUST;
            // Row frame line (between rows) is disabled for cleaner view
            for (let laneName in op.lanes) {
                let lane = op.lanes[laneName];
                for (let s of lane.stages) {
                    let sx = (s.startCycle - left) * self.opW_;
                    let ex = (s.endCycle - left) * self.opW_;
                    if (ex - sx < 1) ex = sx + 1;
                    let sy = py + self.lane_height_margin_;
                    let eh = Math.max(
                        0.5,
                        self.opH_ - self.lane_height_margin_ * 2,
                    );
                    if (sx > width || ex < 0) continue;
                    // Fill stage background with gradient (begin -> end) to match original
                    let grad = ctx.createLinearGradient(0, sy, 0, sy + eh);
                    grad.addColorStop(
                        0,
                        self.getStageColor_(laneName, s.name, true, op),
                    );
                    grad.addColorStop(
                        1,
                        self.getStageColor_(laneName, s.name, false, op),
                    );
                    ctx.fillStyle = grad;
                    ctx.fillRect(sx, sy, ex - sx, eh);
                    // Stage rectangle border
                    if (self.canDrawFrame) {
                        ctx.lineWidth = Number(
                            self.style_.pipelinePane.borderWeight,
                        );
                        ctx.strokeStyle = self.style_.pipelinePane.borderColor;
                        ctx.strokeRect(sx, sy, ex - sx, eh);
                    }
                    // Stage name text and stage length counters
                    if (self.canDrawText) {
                        ctx.fillStyle = self.style_.pipelinePane.fontColor;
                        let fontSizeRaw = self.stageFontSize_;
                        let textTop =
                            py +
                            (self.opH_ -
                                self.lane_height_margin_ * 2 -
                                fontSizeRaw) /
                                2 +
                            fontSizeRaw;
                        let textLeft = (s.startCycle - left) * self.opW_;
                        let margin = Math.max(
                            0,
                            (self.opW_ - (s.name.length * fontSizeRaw) / 2) / 2,
                        );
                        ctx.fillText(s.name, textLeft + margin, textTop);
                        // Counter numbers for long stages
                        let len = Math.max(0, s.endCycle - s.startCycle);
                        for (let j = 1; j < len; j++) {
                            if (
                                s.startCycle + j >
                                left + Math.ceil(width / self.opW_)
                            )
                                break;
                            let numMargin = Math.max(
                                0,
                                (self.opW_ -
                                    (String(j).length * fontSizeRaw) / 2) /
                                    2,
                            );
                            ctx.fillText(
                                String(j),
                                textLeft + j * self.opW_ + numMargin,
                                textTop,
                            );
                        }
                    }
                }
            }
        }
        // Dependency arrows
        if (self.depArrowType_ !== "notShow" && self.canDrawDependency) {
            ctx.strokeStyle = self.style_.pipelinePane.arrowColor;
            ctx.lineWidth = Number(self.style_.pipelinePane.arrowWeight);
            const visibleBottom = top + Math.ceil(height / self.opH_);
            for (let y = 0; y < Math.ceil(height / self.opH_); y++) {
                let op = self.getVisibleOp(top + y, this.opResolution);
                if (!op) continue;
                // Draw producers -> this op
                for (let d of op.prods || []) {
                    let prod = self.getOpFromID(d.opID, this.opResolution);
                    if (!prod) continue;
                    let cy = (op.id - top) * self.opH_ + self.opH_ / 2;
                    let py2 = (prod.id - top) * self.opH_ + self.opH_ / 2;
                    if (prod.id < top || prod.id > visibleBottom) continue; // limit within tile
                    let x1 = (Math.max(left, d.cycle) - left) * self.opW_;
                    let x0 =
                        (Math.max(
                            left,
                            prod.prodCycle >= 0
                                ? prod.prodCycle
                                : prod.fetchedCycle,
                        ) -
                            left) *
                        self.opW_;
                    if (self.depArrowType_ === "insideLine") {
                        ctx.beginPath();
                        ctx.moveTo(x0, py2);
                        ctx.lineTo(x1, cy);
                        ctx.stroke();
                    } else if (self.depArrowType_ === "leftSideCurve") {
                        // Curve on left side
                        let ctrlX = Math.min(x0, x1) - self.opW_ * 2;
                        ctx.beginPath();
                        ctx.moveTo(x0, py2);
                        ctx.quadraticCurveTo(ctrlX, (py2 + cy) / 2, x1, cy);
                        ctx.stroke();
                    }
                }
            }
        }
        ctx.restore();
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
}

module.exports.KonataRenderer = KonataRenderer;
module.exports.DEP_ARROW_TYPE = DEP_ARROW_TYPE;
