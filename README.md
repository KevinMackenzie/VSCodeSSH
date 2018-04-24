# VSCodeSSH

A no-frills Visual Studio Code plugin for editing remote files over SSH.

## Motivation

It is often convenient to have your git repository cloned on the remote server for development, but editing over SSH using vim isn't for everyone.  This allows developers to use the powerful Visual Studio Code environment on remote files.

## Configuring
In the root of the open directory, there is a file named `.sshsettings`.  Instead of explaining these in depth, here is a sample of the json:

```
{
  "invalidated": false,
  "host": "127.0.0.1",
  "username": "ssh_username",
  "password": "ssh_password",
  "remoteRoot": "/home/ssh_username/test-ssh/",
  "activeFiles": [
    "Other File",
    "Folder/SubItem",
    "TestNewFolder/AnotherFile"
  ]
}
```
`invalidated` should always be `false`.  There is currently no support for ssh private keys.  Each `activeFile` must be listed, listing a directory will not sync the whole directory.

## Features

There are three commands in the workflow of this plugin.  

### Load SSH Settings
This command must be called before doing any work.  It initializes the plugin and, more importantly, reloads he `.sshsettings` file.

### SSH Force Push Changes
Call this when there are changes to files made when the plugin wasn't loaded or outside of VS Code.

### SSH Pull Remote
Use this to update the local copies of the files to the remote version.

### On-Save Updates
Whenever an active file gets saved, the file gets uploaded to the remote, so you may not want to save too often if the file is large and you plan on making lots of changes.

## Release Notes

### Version 0.1
Initial commit.  It supports the bare-bone features with limited error checking.