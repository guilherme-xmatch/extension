"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const vscode = __importStar(require("vscode"));
const extension_1 = require("../../src/extension");
const vscode_mock_1 = require("../setup/vscode.mock");
const tempWorkspace_1 = require("../setup/tempWorkspace");
(0, vitest_1.describe)('extension activation', () => {
    let cleanup;
    (0, vitest_1.afterEach)(async () => {
        (0, vscode_mock_1.setWorkspaceRoot)(undefined);
        await cleanup?.();
        cleanup = undefined;
    });
    (0, vitest_1.it)('registra comandos principais sem crash', async () => {
        const workspace = await (0, tempWorkspace_1.createTempWorkspace)();
        cleanup = workspace.cleanup;
        (0, vscode_mock_1.setWorkspaceRoot)(workspace.root);
        (0, vscode_mock_1.setConfigurationValue)('descomplicai.registryUrl', '');
        (0, vscode_mock_1.setConfigurationValue)('descomplicai.autoHealthCheck', false);
        (0, vscode_mock_1.setConfigurationValue)('descomplicai.showWelcome', false);
        const context = {
            extensionUri: vscode.Uri.file(workspace.root),
            subscriptions: [],
            globalState: {
                get: () => false,
                update: async () => undefined,
            },
        };
        (0, extension_1.activate)(context);
        (0, vitest_1.expect)((0, vscode_mock_1.getRegisteredCommands)()).toEqual(vitest_1.expect.arrayContaining([
            'dai.install',
            'dai.uninstall',
            'dai.healthCheck',
            'dai.refresh',
            'dai.installBundle',
            'dai.importCustomMcp',
        ]));
    });
});
//# sourceMappingURL=activate.test.js.map