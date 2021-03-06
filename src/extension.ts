'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
const node_ssh = require('node-ssh');

class SSHSettings
{
    username:    string = "";
    password:    string = "";
    privateKey:  string = "";
    host:        string = "";
    remoteRoot:  string = ""; // default: user folder
    localRoot:   string = ""; // always workspace folder
    activeFiles: string[] = [];
}
function sshSettingsReplacer(key: string, value: string)
{
    // Don't save this property, it is setup on load
    if (key === "localRoot") 
    { 
        return undefined; 
    }
    else 
    {
        return value;
    }
}

/** Gloabl {@link node_ssh} instance */
var _ssh = new node_ssh();

/** 
 * Attempts to load the ssh connection settings from ".sshsettings" 
 *  file in the workspace root.  Resolves undefined if no workspace
 *  is open or a blank ".sshsettings" file was generated.
 */
function loadSettingsFile(): Promise<SSHSettings | undefined>
{
    return new Promise((resolve, reject) => {
        if (vscode.workspace.workspaceFolders === undefined)
        {
            // workspace not open, so tell the user that
            vscode.window.showInformationMessage('Open a Workspace to Start working over SSH');
            resolve(undefined);
            return;
        }

        // Check to see if a '.sshsettings' file exists in the workspace root
        let localDir = vscode.workspace.workspaceFolders[0].uri.path;
        let filePath = localDir + "/.sshsettings";
        let settings: SSHSettings;

        fs.exists(filePath, (exists) => {
            if(exists)
            {
                // The file exists, so try to load it
                fs.readFile(filePath, (err, data) => {
                    // Failed to load the file for some reason...
                    if (err) {
                        vscode.window.showErrorMessage('Failed to open .sshsettings file');
                        reject(err);
                        return;
                    }
            
                    // try to load the ssh settings
                    try {
                        settings = JSON.parse(data.toString());
                        settings.localRoot = localDir;
                        resolve(settings);
                    } catch (error) {
                        vscode.window.showErrorMessage('Failed to load ".sshsettings" file.  It may be corrupt.');
                        reject(error);
                    }
                });
            }
            else
            {
                // The file doesn't exist, so save a blank one
                saveSSHSettings(filePath, new SSHSettings());   
                vscode.window.showInformationMessage('Generated Blank ".sshsettings" file.  Fill this out to get started.');
        
                // Doesn't exist.  Not an error though.
                resolve(undefined);
            }
        });
    });
}

/**
 * A helper method to log an error and notify the user of an SSH
 *  connection failure
 * @param reason The error object
 * @param host The host the plugin attempted to connect to
 */
function sshConnectionFail(reason: any, host: string)
{
    console.error('Error connecting to SSH!');
    console.error(reason);
    vscode.window.showErrorMessage('Error Connecting to SSH Host: "' + host + '"');
}

/**
 * A helper method for connecting the a {@link node_ssh} instance using
 *  this plugin's settings type.  Note that this does no validation
 *  of either parameter.
 * @param sshInstance The {@link node_ssh} instance
 * @param settings The plugin settings instance
 */
function sshConnect(sshInstance: any, settings: SSHSettings): Promise<void>
{
    return sshInstance.connect({
        host: settings.host,
        username: settings.username,
        privateKey: settings.privateKey,
        password: settings.password
    });
}

/**
 * Recursively finds the contents of an SSH directory and calls the provided
 *  method on each found file in parallel.
 * @param sshInstance The {@link node_ssh} instance
 * @param remotePath The remote directory to iterate through
 * @param callback the method to call on each file
 */
function iterateSSHDirContents(sshInstance: any, remotePath: string, callback: (entry: string) => void): void
{
    sshInstance.exec("find", [remotePath, '-type', 'f']).then(
        (results: string) => {
            results.split("\n").forEach((value, index, array) => {
                callback(value.substr(remotePath.length));
            });
        }
    ).catch((reason: any) => {
        console.error('Error Iterating SSH Directory: "' + remotePath + '"');
        console.error(reason);
    });
}

/**
 * Downloads a single file from the remote to the local.
 * @param sshInstance The {@link node_ssh} instance
 * @param localFile The path of the local file to download to
 * @param remoteFile The path of the source file in the remote
 */
function pullSSHFile(sshInstance: any, localFile: string, remoteFile: string): void
{
    console.log('Downloading: "' + remoteFile + '" to "' + localFile + '"');
    sshInstance.getFile(
        localFile, remoteFile).then(
            () => console.log('Downloaded file: "' + remoteFile + '"')
        ).catch((reason: any) => {
            console.error('Error Pulling File: "' + remoteFile + '"');
            console.error(reason);
        });
}

/**
 * Downlods all provided files/directories in parallel from the ssh server
 * @param sshInstance The {@link node_ssh} instance
 * @param localRoot The base path for local files
 * @param remoteRoot The base path for remote files
 * @param files The list of files/directories to upload
 */
function pullSSHFiles(sshInstance: any, localRoot: string, remoteRoot: string, files: string[]): void
{
    files.forEach((value, index, array) =>{
        let remoteVal = remoteRoot + '/' + value;
        let localVal = localRoot + '/' + value;
        if(value.endsWith('/'))
        {
            // directory
            iterateSSHDirContents(sshInstance, remoteVal, 
                (file: string) => pullSSHFile(sshInstance, localVal + file, remoteVal + file));
        }
        else
        {
            // file
            pullSSHFile(sshInstance, localVal, remoteVal);
        }
    });
}

/**
 * Uploads a single file from the local to the remote
 * @param sshInstance The {@link node_ssh} instance
 * @param localFile The path of the local file to upload
 * @param remoteFile The path of the destination file in the remote
 */
function pushSSHFile(sshInstance: any, localFile: string, remoteFile: string): void
{
    console.log('Uploading: "' + localFile + '" to "' + remoteFile + '"');
    sshInstance.putFile(
        localFile, remoteFile).then(
            () => console.log('Uploaded file: "' + remoteFile + '"')
        ).catch((reason: any) => {
            console.error('Error Pushing File: "' + remoteFile + '"');
            console.error(reason);
        });
}

/**
 * Uploads all provided files/directories in parallel to the ssh server
 * @param sshInstance The {@link node_ssh} instance
 * @param localRoot The base path for local files
 * @param remoteRoot The base path for remote files
 * @param files The list of files/directories to download
 */
function pushSSHFiles(sshInstance: any, localRoot: string, remoteRoot: string, files: string[]): void
{
    files.forEach((value, index, array) =>{
        let remoteVal = remoteRoot + '/' + value;
        let localVal = localRoot + '/' + value;
        if(value.endsWith('/'))
        {
            // directory
            console.log('Uploading: "' + localVal + '" to "' + remoteVal + '"');
            sshInstance.putDirectory(
                localVal, 
                remoteVal
            ).then(
                (result: boolean) => console.log('Uploaded Dir: ' + remoteVal + (!result ? ' not all succeeded...' : ''))
            ).catch((reason: any) => {
                console.error('Error Pushing Dir: "' + remoteVal + '"');
                console.error(reason);
            });
        }
        else
        {
            // file
            pushSSHFile(sshInstance, localVal, remoteVal);
        }
    });
}

/**
 * Saves the given settings to the given file path (json)
 * @param filePath The path to save the file to
 * @param settings The settings to save
 */
function saveSSHSettings(filePath: string, settings: SSHSettings): void
{
    // Save the file
    fs.writeFile(filePath, JSON.stringify(settings, sshSettingsReplacer, 2), "utf-8", (err) =>
    {
        if(err !== null)
        {
            console.error('Error writing to ".sshsettings": ' + err);
            vscode.window.showErrorMessage('Error writing to ".sshsettings"');
        }
    });
}

/**
 * This method is called when the plugin is activated.
 */
export function activate(context: vscode.ExtensionContext) 
{
    // The command for initializing the extension and validating the extension file
    let loadSSHDisposable = vscode.commands.registerCommand('extension.loadSSH', () => {
        loadSettingsFile();

        vscode.window.showInformationMessage('Loaded SSH Extension');
    });

    // The command for pushing all files to the remote
    let pushSSHDisposable = vscode.commands.registerCommand('extension.pushSSH', () => {
        
        loadSettingsFile().then((config) => {
            if(config !== undefined)
            {
                // guarantee conf not undefined
                let conf = config;
                sshConnect(_ssh, config).then(() => pushSSHFiles(_ssh, conf.localRoot, conf.remoteRoot, conf.activeFiles))
                    .catch((reason) => sshConnectionFail(reason, conf.host));
            }
        }).catch((reason) => {
            console.error(reason);
        });
    });

    // The command fo rpulling all files from the remote
    let pullSSHDisposable = vscode.commands.registerCommand('extension.pullSSH', () => {
        
        loadSettingsFile().then((config) => {
            if(config !== undefined)
            {
                // guarantee conf not undefined
                let conf = config;
                sshConnect(_ssh, config).then(() => pullSSHFiles(_ssh, conf.localRoot, conf.remoteRoot, conf.activeFiles))
                    .catch((reason) => sshConnectionFail(reason, conf.host));
            }
        }).catch((reason) => {
            console.error(reason);
        });
    });

    // When the user saves the document, we want to upload it
    vscode.workspace.onDidSaveTextDocument((event) =>
    {
        loadSettingsFile().then((config) => {
            if(config !== undefined)
            {
                // guarantee conf not undefined
                let conf = config;

                if(event.fileName.startsWith(conf.localRoot))
                {
                    let fileName = event.fileName.substr(conf.localRoot.length + 1);

                    // We upload the file if its directly in the list or is in a directory in the list
                    let found = conf.activeFiles.find((element: string) => 
                        element === fileName || (element.endsWith('/') && fileName.startsWith(element)));
                    if(found !== undefined)
                    {
                        console.log('Uploading saved file...');
                        sshConnect(_ssh, conf).then(() => pushSSHFile(_ssh, event.fileName, conf.remoteRoot + '/' + fileName))
                            .catch((reason) => sshConnectionFail(reason, conf.host));
                    }
                }
            }
        }).catch((reason) => {
            console.error(reason);
        });
    });

    context.subscriptions.push(loadSSHDisposable);
    context.subscriptions.push(pushSSHDisposable);
    context.subscriptions.push(pullSSHDisposable);
}

/** 
 * This method is called when the extension is deactivated.
 */
export function deactivate() {
}