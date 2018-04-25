'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import fs = require('fs');
const node_ssh = require('node-ssh');

class SSHSettings
{
    invalidated: boolean = true;
    username: string = "";
    password: string = "";
    privateKey: string = "";
    host: string = "";
    remoteRoot: string = ""; // default: user folder
    activeFiles: string[] = [];
}

// Global settings for the plugin
var _sshSettings: SSHSettings = new SSHSettings();
var _ssh = new node_ssh();

function ensureSettingsFile(): boolean {
    if (vscode.workspace.workspaceFolders === undefined)
    {
        // workspace not open, so tell the user that
        vscode.window.showInformationMessage('Open a Workspace to Start working over SSH');
        return false;
    }
    // Check to see if a '.sshsettings' file exists in the workspace root
    var filePath = vscode.workspace.workspaceFolders[0].uri.path + "/.sshsettings";
    fs.exists(filePath, (exists) => {
        if(exists)
        {
            // The file exists, so try to load it
            fs.readFile(filePath, (err, data) => {
                // Failed to load the file for some reason...
                if (err) {
                    console.error(err);
                    vscode.window.showErrorMessage('Failed to open .sshsettings file');
                }
        
                // try to load the ssh settings
                try {
                    _sshSettings = JSON.parse(data.toString());
                } catch (error) {
                    _sshSettings.invalidated = true;
                    console.error(error);
                    vscode.window.showErrorMessage('Failed to load ".sshsettings" file.  It may be corrupt.');
                }
            });
        }
        else
        {
            // The file doesn't exist, so save a blank one
            _sshSettings = new SSHSettings();
            saveSSHSettings(filePath, _sshSettings);                    
        }
    });
    return true;
}

function callSSHMethod(ssh: any, settings: SSHSettings, 
    method: (sshInstance: any, settings: SSHSettings, file: number | string) => any, file: number | string)
{
    ssh.connect({
        host: settings.host,
        username: settings.username,
        privateKey: settings.privateKey,
        password: settings.password
    }).then(() => {
        // Download the "active files"
        method(ssh, settings, file);
    }, (err: any) => {
        console.error(err);
        vscode.window.showErrorMessage('Failed to connect to SSH host: "' + settings.host + '"');
    });
}

function iterateSSHDirContents(sshInstance: any, remotePath: string, callback: (entry: string) => void): void
{
    sshInstance.exec("find", [remotePath, '-type', 'f']).then(
        (results: string) => {
            results.split("\n").forEach((value, index, array) => {
                callback(value.substr(remotePath.length));
            });
        },
        (err: any) => {
            console.error(err);
        }
    );
}
function pullSSHFile(sshInstance: any, localFile: string, remoteFile: string): void
{
    sshInstance.getFile(
        localFile, remoteFile).then(
            () => console.log('Downloaded file: ' + remoteFile),
            (err: any) => console.error(err));
}
function pullSSHFiles(sshInstance: any, settings: SSHSettings, file: number | string): void
{
    if(vscode.workspace.workspaceFolders !== undefined)
    {
        if(typeof file === "number")
        {
            if(file >= settings.activeFiles.length)
            {
                // Base case
                return;
            }
            
            var workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

            var localFile = workspaceRoot + '/' + settings.activeFiles[file];
            var remoteFile = settings.remoteRoot + '/' + settings.activeFiles[file];

            console.log('Downloading: "' + settings.host + '":"' + remoteFile + '" to "' + localFile + '"');


            var onComplete = () =>
            {
                console.log('Downloaded file: ' + file);
                pullSSHFiles(sshInstance, settings, file + 1);
            };

            var onError = (err: any) => 
            {
                console.log('Error downloading file: ' + remoteFile);
                console.error(err);
                pullSSHFiles(sshInstance, settings, file + 1);
            };

            // we got an index, so start downloading there
            if(localFile.endsWith("/"))
            {
                // directory, so get its contents
                iterateSSHDirContents(sshInstance, remoteFile, (entry) =>{
                    console.log('Downloading file ' + entry);
                    pullSSHFile(sshInstance, localFile + '/' + entry, remoteFile + '/' + entry);
                });
            }
            else
            {
                // file
                sshInstance.getFile(
                    localFile,
                    remoteFile
                ).then(onComplete, onError);
            }
        }
        else if(typeof file === "string")
        {
            // we got a name, so ONLY download that
            pullSSHFile(sshInstance, 
                vscode.workspace.workspaceFolders[0].uri.fsPath + '/' + file, 
                settings.remoteRoot + file);
        }
    }
}
function pushSSHFiles(sshInstance: any, settings: SSHSettings, file: number | string): void
{
    if(vscode.workspace.workspaceFolders !== undefined)
    {
        // push all local files to remote
        if(typeof file === "number")
        {
            // we got an index, so upload starting there
            if(file >= settings.activeFiles.length)
            {
                // Base case
                return;
            }
            
            var localFile = vscode.workspace.workspaceFolders[0].uri.fsPath + '/' + settings.activeFiles[file];
            var remoteFile = settings.remoteRoot + '/' + settings.activeFiles[file];

            console.log('Uploading: "' + localFile + '" to "' + settings.host + '":"' + remoteFile + '"');

            var onComplete = () =>
            {
                console.log('Uploaded file: ' + file);
                pushSSHFiles(sshInstance, settings, file + 1);
            };

            var onError = (err: any) => 
            {
                console.log('Error uploading file: ' + remoteFile);
                console.error(err);
                pushSSHFiles(sshInstance, settings, file + 1);
            };

            // we got an index, so start downloading there
            if(localFile.endsWith("/"))
            {
                // directory
                sshInstance.putDirectory(
                    localFile, 
                    remoteFile
                ).then(onComplete,onError);
            }
            else
            {
                // file
                sshInstance.putFile(
                    localFile, 
                    remoteFile
                ).then(onComplete, onError);
            }
        }
        else if(typeof file === "string")
        {
            // we got a name, so ONLY upload that
            sshInstance.putFile(
                vscode.workspace.workspaceFolders[0].uri.fsPath + '/' + file,
                settings.remoteRoot + file).then(
                    () => console.log('Uploaded file: ' + file),
                    (err: any) => console.error(err));
        }
    }    
}

function saveSSHSettings(filePath: string, settings: SSHSettings): void
{
    // Once connected, set invalidated to false
    settings.invalidated = false;

    // Save the file
    fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf-8", (err) =>
    {
        if(err !== null)
        {
            console.log('Error writing to ".sshsettings": ' + err);
            vscode.window.showErrorMessage('Error writing to ".sshsettings"');
        }
    });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let loadSSHDisposable = vscode.commands.registerCommand('extension.loadSSH', () => {
        if(ensureSettingsFile())
        {
            vscode.window.showInformationMessage('Loaded SSH Plugin Config');
        }
        else
        {
            vscode.window.showErrorMessage('Failed to load SSH Plugin Config!');
        }
    });

    let pushSSHDisposable = vscode.commands.registerCommand('extension.pushSSH', () => {
        // Check to see if there is a workspace open
        if(ensureSettingsFile())
        {
            callSSHMethod(_ssh, _sshSettings, pushSSHFiles, 0);
        }
        else
        {
            vscode.window.showErrorMessage('Failed to load SSH Plugin Config!');
        }
    });

    let pullSSHDisposable = vscode.commands.registerCommand('extension.pullSSH', () => {
        if(ensureSettingsFile())
        {
            callSSHMethod(_ssh, _sshSettings, pullSSHFiles, 0);
        }
        else
        {
            vscode.window.showErrorMessage('Failed to load SSH Plugin Config!');
        }
    });

    vscode.workspace.onDidChangeWorkspaceFolders((event) =>
    {
        console.log('Invalidated Settings due to workspace change');
        _sshSettings.invalidated = true;
    });

    vscode.workspace.onDidSaveTextDocument((event) =>
    {
        if(vscode.workspace.workspaceFolders !== undefined)
        {
            if(event.fileName.startsWith(vscode.workspace.workspaceFolders[0].uri.fsPath))
            {
                var fileName = event.fileName.substr(vscode.workspace.workspaceFolders[0].uri.fsPath.length + 1);

                // This is the only case where we may be invalidated (ensureSettingsFile does this)
                if(_sshSettings.invalidated === false)
                {
                    // document saved, so push to remote if in list
                    var found = _sshSettings.activeFiles.find((element: string) => element === fileName);
                    if(found !== undefined)
                    {
                        console.log('Uploading saved file...');
                        callSSHMethod(_ssh, _sshSettings, pushSSHFiles, fileName);
                    }
                }
            }
        }
    });

    context.subscriptions.push(loadSSHDisposable);
    context.subscriptions.push(pushSSHDisposable);
    context.subscriptions.push(pullSSHDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
}