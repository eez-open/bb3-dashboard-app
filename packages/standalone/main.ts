require("app-module-path").addPath(__dirname + "/..");

import { app, ipcMain, powerSaveBlocker, BrowserWindow } from "electron";
import { configure } from "mobx";

require("@electron/remote/main").initialize();

// disable security warnings inside dev console
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = true as any;

configure({ enforceActions: "observed" });

import { unloadVisa } from "instrument/connection/interfaces/visa-dll";
import { isDev } from "eez-studio-shared/util-electron";

import { observable, runInAction } from "mobx";

import { getIcon } from "main/util";
import {
    settingsRegisterWindow,
    settingsSetWindowBoundsIntoParams
} from "main/settings";
import { sourceRootDir } from "eez-studio-shared/util";
import { resolve } from "path";

////////////////////////////////////////////////////////////////////////////////

const resourceFolderPath = isDev
    ? resolve(`${sourceRootDir()}/../resources`)
    : process.resourcesPath!;

const manifestJson = require(resourceFolderPath + "/manifest.json");

////////////////////////////////////////////////////////////////////////////////

app.commandLine.appendSwitch("disable-renderer-backgrounding");

// app.allowRendererProcessReuse = false;

app.on("ready", async function () {
    const { loadSettings } = await import("main/settings");
    await loadSettings();

    const { loadExtensions } = await import(
        "eez-studio-shared/extensions/extensions"
    );
    loadExtensions([]);

    await import("instrument/connection/interfaces/serial-ports-main");

    require("eez-studio-shared/service");

    await openHomeWindow();

    //await import("main/menu");
});

async function openHomeWindow() {
    const HOME_WINDOW_PARAMS = {
        url: "standalone/index.html",
        hideOnClose: true
    };

    const wnd = openWindow(HOME_WINDOW_PARAMS);

    if (!isDev) {
        wnd.setMenu(null);
    }

    return wnd;
}

let powerSaveBlockerId: number | undefined = undefined;
ipcMain.on("preventAppSuspension", (event: any, on: boolean) => {
    if (on) {
        if (powerSaveBlockerId == undefined) {
            powerSaveBlockerId = powerSaveBlocker.start(
                "prevent-app-suspension"
            );
        }
    } else {
        if (powerSaveBlockerId != undefined) {
            powerSaveBlocker.stop(powerSaveBlockerId);
            powerSaveBlockerId = undefined;
        }
    }
});

process.on("warning", e => console.warn(e.stack));

app.on("quit", function () {
    unloadVisa();
});

/////

interface IWindowSate {
    modified: boolean;
    undo: string | null;
    redo: string | null;
}

interface IWindowParams {
    url: string;
    hideOnClose?: boolean;
}

type ActiveTabType =
    | "instrument"
    | "project"
    | "home"
    | "history"
    | "shortcutsAndGroups"
    | "extensions"
    | "settings"
    | "notebooks"
    | undefined;

interface IWindow {
    url: string;
    browserWindow: Electron.BrowserWindow;
    readyToClose: boolean;
    state: IWindowSate;
    focused: boolean;
    activeTabType: ActiveTabType;
}

const windows = observable<IWindow>([]);

function createWindow(params: IWindowParams) {
    let windowUrl = params.url;
    if (!windowUrl.startsWith("file://")) {
        windowUrl = `file://${sourceRootDir()}/${windowUrl}`;
    }

    var windowContructorParams: Electron.BrowserWindowConstructorOptions = {
        webPreferences: {
            nodeIntegration: true,
            webSecurity: false,
            webviewTag: true,
            nodeIntegrationInWorker: true,
            plugins: true,
            contextIsolation: false,
            backgroundThrottling: false
        },
        show: false,
        width: manifestJson.window?.width,
        height: manifestJson.window?.height
    };

    settingsSetWindowBoundsIntoParams(params.url, windowContructorParams);

    windowContructorParams.icon = getIcon();

    let browserWindow = new BrowserWindow(windowContructorParams);
    require("@electron/remote/main").enable(browserWindow.webContents);

    runInAction(() =>
        windows.push({
            url: params.url,
            browserWindow,
            readyToClose: false,
            state: {
                modified: false,
                undo: null,
                redo: null
            },
            focused: false,
            activeTabType: undefined
        })
    );
    let window = windows[windows.length - 1];

    settingsRegisterWindow(params.url, browserWindow);

    browserWindow.loadURL(windowUrl);

    browserWindow.show();

    browserWindow.on("close", function (event: any) {
        if (!window.readyToClose) {
            browserWindow.webContents.send("beforeClose");
            event.preventDefault();
        } else {
            app.quit();
        }
    });

    return browserWindow;
}

function findWindowByParams(params: IWindowParams) {
    return windows.find(win => win.url === params.url);
}

function openWindow(params: IWindowParams) {
    return createWindow(params);
}

function findWindowByWebContents(webContents: Electron.WebContents) {
    return windows.find(win => win.browserWindow.webContents === webContents);
}

////////////////////////////////////////////////////////////////////////////////

ipcMain.on("focusWindow", function (event: any, params: any) {
    let win = findWindowByParams(params);
    if (win) {
        win.browserWindow.focus();
        event.returnValue = true;
    } else {
        event.returnValue = false;
    }
});

app.on(
    "browser-window-focus",
    function (event: Electron.Event, browserWindow: Electron.BrowserWindow) {
        runInAction(() => {
            windows.forEach(window => {
                window.focused = window.browserWindow === browserWindow;
            });
        });
    }
);

ipcMain.on("readyToClose", (event: any) => {
    const window = findWindowByWebContents(event.sender);
    if (window) {
        runInAction(() => {
            window.readyToClose = true;
        });
        window.browserWindow.close();
    }
});

ipcMain.on("reload", (event: any) => {
    const window = findWindowByWebContents(event.sender);
    if (window) {
        window.browserWindow.webContents.reload();
        window.browserWindow.webContents.clearHistory();
    }
});

ipcMain.on(
    "set-window-size",
    (event: any, size: { width: number; height: number }) => {
        const window = findWindowByWebContents(event.sender);
        if (window) {
            if (!window.browserWindow.isMaximized()) {
                // TODO doesn't work reliably
                // window.browserWindow.setSize(size.width, size.height);
            }
        }
    }
);
