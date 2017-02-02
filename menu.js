function installMenu(){

    /* global RiotControl ACTION */
    let rc = RiotControl;
    let remote = require("electron").remote;

    let menuTemplate = [
        {
            label: "ファイル",
            submenu: [
                {
                    label: "Open",
                    accelerator: "Command+O",
                    click: function(){rc.trigger(ACTION.DIALOG_FILE_OPEN);}
                },
                {
                    label: "Quit",
                    accelerator: "Command+Q",
                    click: function(){rc.trigger(ACTION.APP_QUIT);}
                },
            ]
        },
        {
            label: "操作",
            submenu: [
                {
                    label:"Next Tab",
                    accelerator:"Command+N",
                    click: function(){rc.trigger(ACTION.TAB_MOVE, true);}
                },
                {
                    label:"Previous Tab",
                    accelerator:"Command+P",
                    click: function(){rc.trigger(ACTION.TAB_MOVE, false);}
                },
                {
                    label:"Zoom out",
                    accelerator:"Command+Shift+=",
                    click: function(){rc.trigger(ACTION.KONATA_ZOOM, false, 0, 0);}
                },
                {
                    label:"Zoom in",
                    accelerator:"Command+-",
                    click: function(){rc.trigger(ACTION.KONATA_ZOOM, true, 0, 0);}
                },
            ]
        },
        {
            label: "表示",
            submenu: [
                {
                    label: "透明化",
                    type: "checkbox",
                    checked: false, // 初期値
                    click: function(e){
                        rc.trigger(ACTION.TAB_TRANSPARENT, e.checked);
                    }
                },
                {
                    label:"全体を橙色に",
                    //accelerator:"Command+-",
                    click: function(){Color("#f80");}
                },
                {
                    label:"全体を青色に",
                    //accelerator:"Command+-",
                    click: function(){Color("#08f");}
                },
                {
                    label:"デフォルトの配色",
                    //accelerator:"Command+-",
                    click: function(){Color(null);}
                },
                {
                    label:"Retina切り替え",
                    //accelerator:"Command+-",
                    click: function(){
                        konata.RetinaSwitch();
                        konata.Draw(index.path);
                    }
                },
            ]
        },
        {
            label: "ヘルプ",
            submenu: [
                {
                    label: "バージョン情報",
                    click: function(){
                        RiotControl.trigger(
                            ACTION.DIALOG_MODAL_MESSAGE,
                            "Konata ver 0.0.2, Kojiro Izuoka and Ryota Shioya."
                        );
                    }
                }
            ]
        }
    ];

    let Menu = remote.Menu;
    let menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);


}

module.exports = installMenu;
