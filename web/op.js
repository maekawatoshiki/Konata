let Stage = require("./stage").Stage;
let Lane = require("./stage").Lane;

class Op {
    constructor() {
        this.id = -1;
        this.gid = -1;
        this.rid = -1;
        this.tid = -1;
        this.retired = false;
        this.flush = false;
        this.eof = false;
        /** @type {Object<string, Lane>} */
        this.lanes = {};
        this.fetchedCycle = -1;
        this.retiredCycle = -1;
        this.line = 0;
        this.labelName = "";
        this.labelDetail = "";
        /** @type {Stage} */
        this.lastParsedStage = null;
        this.lastParsedCycle = -1;
        /** @type {Dependency[]} */
        this.prods = [];
        /** @type {Dependency[]} */
        this.cons = [];
        this.prodCycle = -1;
        this.consCycle = -1;
    }
}

class Dependency {
    constructor(opID, type, cycle) {
        this.opID = opID;
        this.type = type;
        this.cycle = cycle;
    }
}

module.exports.Op = Op;
module.exports.Dependency = Dependency;
