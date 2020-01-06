import {
  app, BrowserWindow, dialog, ipcMain, IpcMainEvent, Menu, MenuItemConstructorOptions, MessageBoxReturnValue,
  nativeTheme, OpenDialogReturnValue, SaveDialogReturnValue, systemPreferences, shell
} from 'electron';
import electronDebug from 'electron-debug';
import { readFile, readFileSync, writeFile } from 'fs';
import { createFileReference, isValidHeader, parseReferencedData, ReferencedData, getSupportedAudioFileExtensions } from './lyricistant-language-helpers';

const recentFilesFilePath: string = `${app.getPath('userData')}/recent_files.json`;

// Allows for opening dev-tools using F12, but only on dev builds.
electronDebug({
  devToolsMode: 'detach',
  showDevTools: false
});

let mainWindow: BrowserWindow;
let currentFilePath: string;
let currentReferenceData: ReferencedData;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: getWindowBackgroundColor(),
    show: false,
    paintWhenInitiallyHidden: false,
    webPreferences: {
      nodeIntegration: true
    }
  });
  mainWindow
    .loadFile('src/html/index.html')
    .catch(() => {
      dialog.showErrorBox('Error', 'Error trying to load the main page.');
    });

  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.send('dark-mode-toggled', nativeTheme.shouldUseDarkColors);
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = undefined;
  });
  setMenu();
}

nativeTheme.on('updated', () => {
  mainWindow.setBackgroundColor(getWindowBackgroundColor());
  mainWindow?.webContents.send('dark-mode-toggled', nativeTheme.shouldUseDarkColors);
});

app.on('ready', createWindow);

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.on('editor-text', (_: IpcMainEvent, text: string) => {
  let writableText: string = text;
  if (currentReferenceData?.dataType === 'file' && currentFilePath.endsWith('lyrics')) {
    writableText = `${createFileReference(currentReferenceData.data)}${text}`;
  }
  writeFile(currentFilePath, writableText, (error: NodeJS.ErrnoException) => {
    mainWindow.webContents.send('file-save-ended', error, currentFilePath);
  });
});

ipcMain.on('prompt-save-file-for-new', () => {
  dialog.showMessageBox(
    mainWindow,
    {
      type: 'question',
      title: 'Confirm Quit',
      message: 'Your changes haven\'t been saved. Are you sure you want to create a new file?',
      buttons: ['Create New File', 'Cancel'],
      cancelId: 1
    })
    .then((value: MessageBoxReturnValue) => {
      if (value.response === 0) {
        mainWindow.webContents.send('force-new-file');
      }
    })
    .catch(() => {
      dialog.showErrorBox('Error', 'Error trying to show the confirm quit dialog for creating a new file.');
    });
});

ipcMain.on('prompt-save-file-for-quit', () => {
  dialog.showMessageBox(
    mainWindow,
    {
      type: 'question',
      title: 'Confirm Quit',
      message: 'Your changes haven\'t been saved. Are you sure you want to quit?',
      buttons: ['Quit', 'Cancel'],
      cancelId: 1
    })
    .then((value: MessageBoxReturnValue) => {
      if (value.response === 0) {
        app.quit();
      }
    })
    .catch(() => {
      dialog.showErrorBox('Error', 'Error trying to show the confirm quit dialog for quiting the app.');
    });
});

ipcMain.on('new-file-created', () => {
  currentFilePath = undefined;
  currentReferenceData = undefined;
});

ipcMain.on('quit', () => {
  app.quit();
});

ipcMain.on('choose-reference-file', () => {
  currentReferenceData = chooseReferenceFile();
  if (currentReferenceData) {
    mainWindow.webContents.send('reference-data-changed', currentReferenceData);
  }
});

ipcMain.on('remove-reference-data', () => {
  currentReferenceData = undefined;
  mainWindow.webContents.send('reference-data-changed', undefined);
});

ipcMain.on('open-referenced-file-external', () => {
  shell.openItem(currentReferenceData.data);
});

// tslint:disable-next-line:max-func-body-length
function setMenu(recentFiles?: string[]): void {
  const menuTemplate: MenuItemConstructorOptions[] = [{
    label: 'File',
    submenu: [
      {
        label: 'New',
        click: newMenuItemHandler,
        accelerator: 'CmdOrCtrl+N'
      },
      { type: 'separator' },
      {
        label: 'Open...',
        click: openMenuItemHandler,
        accelerator: 'CmdOrCtrl+O'
      },
      {
        label: 'Open Recent',
        submenu: createRecentFilesSubmenu(recentFiles)
      },
      { type: 'separator' }, {
        label: 'Save',
        click: saveMenuItemHandler,
        accelerator: 'CmdOrCtrl+S'
      }, {
        label: 'Save As...',
        click: saveAsHandler,
        accelerator: 'Shift+CmdOrCtrl+S'
      }]
  }, {
    label: 'Edit',
    submenu: [
      {
        label: 'Undo',
        click: undoHandler,
        accelerator: 'CmdOrCtrl+Z'
      },
      {
        label: 'Redo',
        click: redoHandler,
        accelerator: 'Shift+CmdOrCtrl+Z'
      },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      {
        label: 'Find',
        accelerator: 'CmdOrCtrl+F',
        click: (): void => {
          mainWindow.webContents.send('find');
        }
      },
      {
        label: 'Replace',
        accelerator: 'CmdOrCtrl+R',
        click: (): void => {
          mainWindow.webContents.send('replace');
        }
      },
      { type: 'separator' },
      { role: 'delete' },
      { role: 'selectAll' }
    ]
  }, {
    role: 'window',
    submenu: [
      { role: 'minimize' }
    ]
  }];
  if (process.platform === 'darwin') {
    menuTemplate.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit',
          click: quitHandler,
          accelerator: 'Cmd+Q'
        }
      ]
    });
  } else {
    (<MenuItemConstructorOptions[]>menuTemplate[0].submenu).push(
      { type: 'separator' },
      {
        label: 'Quit',
        click: quitHandler,
        accelerator: 'Alt+F4'
      });
  }

  const mainMenu: Menu = Menu.buildFromTemplate(menuTemplate);

  Menu.setApplicationMenu(mainMenu);
}

function newMenuItemHandler(): void {
  mainWindow.webContents.send('new-file');
}

function openMenuItemHandler(): void {
  dialog.showOpenDialog(
    mainWindow,
    {
      properties: ['openFile'],
      filters: [
        { name: 'Lyric Files', extensions: ['lyrics'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
  )
    .then((value: OpenDialogReturnValue) => {
      if (value.filePaths?.length > 0) {
        const filePath: string = value.filePaths[0];
        openLyricsFile(filePath);
      }
    })
    .catch(() => {
      dialog.showErrorBox('Error', 'Error trying to show the open file dialog.');
    });
}

function openLyricsFile(filePath: string): void {
  readFile(filePath, 'utf8', (error: Error, data: string) => {
    currentFilePath = filePath;

    let editorText: string = data;
    const firstLine: string = data.substring(0, data.indexOf('\n'));
    const hasReferencedData: boolean = isValidHeader(firstLine);
    if (hasReferencedData && currentFilePath.endsWith('lyrics')) {
      editorText = data.substr(data.indexOf('\n') + 1);
      currentReferenceData = parseReferencedData(firstLine);
    } else {
      currentReferenceData = undefined;
    }

    mainWindow.webContents.send('file-opened', error, filePath, editorText);

    if (currentReferenceData) {
      mainWindow.webContents.send('reference-data-changed', currentReferenceData);
    }
    addToRecentFiles(filePath);
  });
}

function saveMenuItemHandler(): void {
  if (!currentFilePath) {
    saveAsHandler();
  } else {
    mainWindow.webContents.send('file-save-started', currentFilePath);
    mainWindow.webContents.send('request-editor-text');
  }
}

function saveAsHandler(): void {
  dialog.showSaveDialog(
    mainWindow,
    {
      filters: [
        { name: 'Lyric Files', extensions: ['lyrics'] },
        { name: 'Text Files', extensions: ['txt'] }
      ]
    }
  )
    .then((value: SaveDialogReturnValue) => {
      if (value.filePath) {
        currentFilePath = value.filePath;
        mainWindow.webContents.send('request-editor-text');
        addToRecentFiles(value.filePath);
      }
    })
    .catch(() => {
      dialog.showErrorBox('Error', 'Error trying to show the save as dialog.');
    });
}

function quitHandler(): void {
  mainWindow.webContents.send('attempt-quit');
}

function undoHandler(): void {
  mainWindow.webContents.send('undo');
}

function redoHandler(): void {
  mainWindow.webContents.send('redo');
}

function createRecentFilesSubmenu(loadedRecentFiles?: string[]): MenuItemConstructorOptions[] {
  let validRecentFiles: string[];
  if (!loadedRecentFiles) {
    // flag is a+ even though we're only reading so that the file is created if it doesn't exist.
    const recentFilesFileContents: string = readFileSync(recentFilesFilePath, { encoding: 'utf8', flag: 'a+' });
    if (recentFilesFileContents.length === 0) {
      validRecentFiles = [];
    } else {
      validRecentFiles = <string[]>JSON.parse(recentFilesFileContents);
    }
  } else {
    validRecentFiles = loadedRecentFiles;
  }

  return validRecentFiles.map((filePath: string) => {
    return {
      label: filePath,
      click: (): void => { openLyricsFile(filePath); }
    };
  });
}

function addToRecentFiles(filePath: string): void {
  readFile(recentFilesFilePath, 'utf8', (err: Error, data: string) => {
    let recentFiles: string[];
    if (data.length === 0) {
      recentFiles = [];
    } else {
      recentFiles = <string[]>JSON.parse(data);
    }

    recentFiles.unshift(filePath);
    if (recentFiles.length > 10) {
      recentFiles.pop();
    }
    // Want this to be unique, but need this to be a list 'cause can't stringify a Set.
    recentFiles = [...new Set(recentFiles)];

    writeFile(recentFilesFilePath, JSON.stringify(recentFiles), () => {
      setMenu(recentFiles);
    });
  });
}

function chooseReferenceFile(): ReferencedData | undefined {
  const filePaths: string[] = dialog.showOpenDialogSync(
    mainWindow,
    {
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: getSupportedAudioFileExtensions() },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
  );

  if (filePaths?.length > 0) {
    return new ReferencedData('file', filePaths[0]);
  }

  return undefined;
}

function getWindowBackgroundColor(): string {
  if (nativeTheme.shouldUseDarkColors) {
    return '#141414';
  } else {
    return '#fafafa';
  }
}
