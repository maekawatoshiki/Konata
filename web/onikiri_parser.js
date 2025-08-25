let Op = require("./op").Op;
let OpList = require("./op_list").OpList;
let { ParsingOpList } = require("./op_list");
let Dependency = require("./op").Dependency;
let Stage = require("./stage").Stage;
let StageLevelMap = require("./stage").StageLevelMap;
let Lane = require("./stage").Lane;
let InternalFileReader = require("./file_reader").FileReader;

class OnikiriParser {
    constructor() {
        this.file_ = null;
        this.updateCallback_ = null;
        this.finishCallback_ = null;
        this.errorCallback_ = null;
        this.curLine_ = 1;
        this.curCycle_ = 0;
        /** @type {OpList} */ this.opListBody_ = new OpList();
        /** @type {ParsingOpList} */ this.parsingOpList_ = new ParsingOpList();
        this.complete_ = false;
        this.laneMap_ = {};
        this.stageLevelMap_ = new StageLevelMap();
        this.startTime_ = 0;
        this.updateTimer_ = 100;
        this.updateCount_ = 0;
        this.closed_ = false;
        this.error_ = false;
        this.numWarning_ = 0;
        this.yieldInterval_ = 4096; // Lines processed before yielding control
        this.yieldCounter_ = 0;
    }
    close() {
        this.closed_ = true;
        this.opListBody_.close();
        this.parsingOpList_.close();
        this.numWarning_ = 0;
    }
    setError_(msg) {
        this.error_ = true;
        console.log(`Error (line:${this.curLine_}): ${msg}`);
    }
    warning_(msg) {
        this.numWarning_++;
        if (this.numWarning_ < 10)
            console.log(`Warning (line:${this.curLine_}): ${msg}`);
        else if (this.numWarning_ == 10)
            console.log(
                "Too many warnings. Now warning messages are omitted to output.",
            );
    }
    get name() {
        return "OnikiriParser";
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
    }
    async parseLine(line) {
        try {
            await this.parseLineBody_(line);
        } catch (e) {
            this.errorCallback_(false, e);
        }
    }
    async parseLineBody_(line) {
        if (this.closed_ || this.error_) return;
        if (this.curLine_ == 1) {
            if (!line.match(/^Kanata/)) {
                this.errorCallback_(true);
                return;
            }
        }
        let args = line.split(/\t/);
        this.parseCommand(args);
        this.curLine_++;
        this.updateTimer_--;
        if (this.updateTimer_ < 0) {
            this.updateTimer_ = 1024 * 32;
            this.updateCallback_(
                (1.0 * this.file_.bytesRead) / (this.file_.fileSize || 1),
                this.updateCount_,
            );
            this.updateCount_++;
        }

        // Yield control to event loop periodically to prevent UI freezing
        this.yieldCounter_++;
        if (this.yieldCounter_ >= this.yieldInterval_) {
            this.yieldCounter_ = 0;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    finishParsing() {
        if (this.closed_) return;
        for (let parsingID_Str of this.parsingOpList_.parsingID_List) {
            let parsingID = Number(parsingID_Str);
            let op = this.opListBody_.getParsedOp(parsingID);
            if (op) break;
            let parsingOp = this.parsingOpList_.getParsingOp(parsingID);
            if (!parsingOp) {
                this.warning_(`Incorrect parsing op appears ${parsingID}`);
                break;
            }
            parsingOp.retiredCycle = this.curCycle_ + 1;
            parsingOp.eof = true;
            this.unescapeLabels(parsingOp);
            this.parsingOpList_.purge(parsingID);
            this.opListBody_.setOp(parsingID, parsingOp);
        }
        this.opListBody_.setParsedLastID(this.parsingOpList_.parsingLastID);
        this.complete_ = true;
        let elapsed = new Date().getTime() - this.startTime_;
        this.updateCallback_(1.0, this.updateCount_);
        this.finishCallback_();
        console.log(`Parsed (${this.name}): ${elapsed} ms`);
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
    parseInitialCommand(id, op, args) {
        if (op != null) {
            this.setError_(`${id} is re-defined in the "I" command.`);
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "I" command must be 4, but it is ${args.length}.`,
            );
        }
        op = new Op();
        op.id = id;
        op.gid = this.parseInt_(args[2]);
        op.tid = this.parseInt_(args[3]);
        op.fetchedCycle = this.curCycle_;
        op.line = this.curLine_;
        this.parsingOpList_.setOp(id, op);
    }
    parseLabelCommand(id, op, args) {
        if (op == null) {
            this.setError_(
                `Undefined id:${id} is referred in the "L" command.`,
            );
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "L" command must be 4, but it is ${args.length}.`,
            );
        }
        let type = this.parseInt_(args[2]);
        let str = args[3];
        if (type == 0) {
            op.labelName += str;
        } else if (type == 1) {
            op.labelDetail += str;
        } else if (type == 2) {
            if (op.lastParsedStage.labels != "")
                op.lastParsedStage.labels += "\n";
            op.lastParsedStage.labels += str;
        }
    }
    parseStartCommand(id, op, args) {
        if (op == null) {
            this.setError_(
                `Undefined id:${id} is referred in the "S" command.`,
            );
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "S" command must be 4, but it is ${args.length}.`,
            );
        }
        let laneName = this.parseStageAndLaneName_(args[2]);
        let stageName = this.parseStageAndLaneName_(args[3]);
        let stage = new Stage();
        stage.name = stageName;
        stage.startCycle = this.curCycle_;
        if (!(laneName in op.lanes)) {
            op.lanes[laneName] = new Lane();
        }
        let laneInfo = op.lanes[laneName];
        if (laneInfo.stages.length > 0) {
            let lastStage = laneInfo.stages[laneInfo.stages.length - 1];
            if (lastStage.endCycle == 0) {
                this.parseEndCommand(id, op, [
                    "E",
                    args[1],
                    laneName,
                    lastStage.name,
                ]);
            }
        }
        laneInfo.stages.push(stage);
        op.lastParsedStage = stage;
        if (stageName.match(/X/)) {
            op.consCycle = this.curCycle_;
        }
        if (!(laneName in this.laneMap_)) {
            this.laneMap_[laneName] = 1;
        }
        this.stageLevelMap_.update(laneName, stageName, laneInfo);
    }
    parseEndCommand(id, op, args) {
        if (op == null) {
            this.setError_(
                `Undefined id:${id} is referred in the "E" command.`,
            );
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "E" command must be 4, but it is ${args.length}.`,
            );
        }
        let laneName = this.parseStageAndLaneName_(args[2]);
        let stageName = this.parseStageAndLaneName_(args[3]);
        let laneInfo = op.lanes[laneName];
        if (!laneInfo) {
            this.setError_(
                `Lane name "${laneName}" is not defined at id:${id}.`,
            );
            return;
        }
        let stage = null;
        let lane = laneInfo.stages;
        for (let i = lane.length - 1; i >= 0; i--) {
            if (lane[i].name == stageName) {
                stage = lane[i];
                break;
            }
        }
        if (stage == null) {
            return;
        }
        stage.endCycle = this.curCycle_;
        if (stage.startCycle != stage.endCycle) {
            laneInfo.level++;
        }
        if (stageName.match(/X/)) {
            op.prodCycle = this.curCycle_ - 1;
        }
    }
    parseRetireCommand(id, op, args) {
        if (op == null) {
            this.setError_(
                `Undefined id:${id} is referred in the "R" command.`,
            );
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "R" command must be 4, but it is ${args.length}.`,
            );
        }
        op.rid = this.parseInt_(args[2]);
        op.retiredCycle = this.curCycle_;
        if (this.parseInt_(args[3]) == 1) {
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
                if (stage.endCycle == 0) {
                    stage.endCycle = this.curCycle_;
                }
            }
        }
        this.unescapeLabels(op);
        this.parsingOpList_.purge(id);
        this.opListBody_.setOp(id, op);
    }
    parseDependencyCommand(id, op, args) {
        if (op == null) {
            this.setError_(
                `Undefined id:${id} is referred in the "W" command.`,
            );
            return;
        }
        if (args.length < 4) {
            this.setError_(
                `The number of the arguments for the "W" command must be 4, but it is ${args.length}.`,
            );
        }
        let prodId = this.parseInt_(args[2]);
        let prod = this.parsingOpList_.getParsingOp(prodId);
        if (!prod) {
            prod = this.opListBody_.getParsedOp(prodId);
        }
        if (!prod) {
            this.setError_(
                `An invalid producer id (${prodId}) is specified for the "W" command.`,
            );
            return;
        }
        let type = this.parseInt_(args[3]);
        op.prods.push(new Dependency(prod.id, type, this.curCycle_));
        prod.cons.push(new Dependency(op.id, type, this.curCycle_));
    }
    /** @param {string[]} args */
    parseCommand(args) {
        let cmd = args[0];
        switch (cmd) {
            case "C":
                if (args.length < 2 || args[1] == "") {
                    this.setError_("'C' command has invalid arguments.");
                    return;
                }
                this.curCycle_ += this.parseInt_(args[1]);
                return;
            case "Kanata":
                return;
            case "C=":
                return;
        }

        let id = this.parseInt_(args[1]);
        let op = this.parsingOpList_.getParsingOp(id);
        let parsedOpUsed = false;
        if (cmd != "I" && !op) {
            op = this.opListBody_.getParsedOp(id);
            if (op) {
                parsedOpUsed = true;
                this.warning_(
                    `Command appears after op:(${id}) is retired or flushed`,
                );
            }
        }

        switch (cmd) {
            case "I":
                this.parseInitialCommand(id, op, args);
                break;
            case "L":
                this.parseLabelCommand(id, op, args);
                break;
            case "S":
                this.parseStartCommand(id, op, args);
                break;
            case "E":
                this.parseEndCommand(id, op, args);
                break;
            case "R":
                this.parseRetireCommand(id, op, args);
                break;
            case "W":
                this.parseDependencyCommand(id, op, args);
                break;
            default:
                this.warning_(`Unknown command:${cmd}`);
                break;
        }

        if (parsedOpUsed) {
            this.opListBody_.setOp(id, op);
        }
    }
    /** @param {string} str*/
    parseInt_(str) {
        if (str == undefined) {
            return 0;
        }
        return Number(str.trim());
    }
    /** @param {string} str*/
    parseStageAndLaneName_(str) {
        if (str == undefined) {
            return "";
        }
        return str.trim();
    }
}

module.exports.OnikiriParser = OnikiriParser;
