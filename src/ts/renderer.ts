
import monacoLoader from 'monaco-loader';
import Snackbar from 'node-snackbar';
import tippy from 'tippy.js';
import WaveSurfer from 'wavesurfer.js';
let monaco: typeof import('monaco-editor');
import syllable from 'syllable';
import { fetchRhymes } from './fetchRhymes';

import { ipcRenderer, shell } from 'electron';

import { editor, IPosition, IRange } from 'monaco-editor';
import { fromEventPattern, merge, Observable, of } from 'rxjs';
import { NodeEventHandler } from 'rxjs/internal/observable/fromEvent';
import { debounceTime, distinctUntilChanged, filter, map, switchMap, tap } from 'rxjs/operators';
import { getSupportedAudioFileExtensions, ReferencedData } from './lyricistant-language-helpers';
import { createLyricistantLanguage, createLyricistantTheme, getCssColor } from './monaco-helpers';
import { Rhyme } from './Rhyme';

const associateFileButton: HTMLElement = document.getElementById('associate-file');
const openExternallyButton: HTMLElement = document.getElementById('open-externally');
const playPauseButton: HTMLImageElement = <HTMLImageElement>document.getElementById('playpause-button');
const audioContainer: HTMLElement = document.getElementById('audio-container');

let editorInstance: import('monaco-editor').editor.ICodeEditor;
let wavesurfer: WaveSurfer;

let modelVersion: number;

monacoLoader()
    .then((loadedMonaco: typeof import('monaco-editor')) => {
        monaco = loadedMonaco;

        monaco.editor.setTheme(createLyricistantTheme(monaco, true));

        const editorElement: HTMLElement = document.getElementById('editor');

        editorInstance = monaco.editor.create(editorElement, {
            lineNumbers: (lineNumber: number): string => syllable(editorInstance.getModel()
                .getLineContent(lineNumber))
                .toString(),
            language: createLyricistantLanguage(monaco),
            fontSize: parseInt(
                getComputedStyle(document.documentElement)
                    .getPropertyValue('--editor-text-size'),
                10),
            overviewRulerBorder: false,
            occurrencesHighlight: false,
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            quickSuggestions: false,
            hideCursorInOverviewRuler: true,
            minimap: {
                enabled: false
            }
        });

        window.onresize = (): void => {
            editorInstance.layout({
                width: editorElement.clientWidth,
                height: editorElement.clientHeight
            });
        };

        setupNewFile();
        attachRhymeCompleter();
    })
    .catch((reason: any) => {
        alert(`Error loading monaco. \n${reason}`);
    });

setupAssociateFileSection();

ipcRenderer.on('new-file', (_: any) => {
    if (modelVersion !== editorInstance.getModel()
        .getAlternativeVersionId()) {
        ipcRenderer.send('prompt-save-file-for-new');
    } else {
        setupNewFile();
    }
});

ipcRenderer.on('attempt-quit', (_: any) => {
    if (modelVersion !== editorInstance.getModel()
        .getAlternativeVersionId()) {
        ipcRenderer.send('prompt-save-file-for-quit');
    } else {
        ipcRenderer.send('quit');
    }
});

ipcRenderer.on('force-new-file', (_: any) => {
    setupNewFile();
});

ipcRenderer.on('file-save-ended', (_: any, error: Error, currentFilePath: string) => {
    if (error) {
        alertError(error);
    } else {
        modelVersion = editorInstance
            .getModel()
            .getAlternativeVersionId();

        document.title = currentFilePath;
        showSnackbar(`${currentFilePath} saved.`);
    }
});

ipcRenderer.on('file-save-started', (_: any, currentFilePath: string) => {
    showSnackbar(`Saving file ${currentFilePath}...`);
});

ipcRenderer.on('request-editor-text', (_: any) => {
    ipcRenderer.send('editor-text', editorInstance.getValue());
});

ipcRenderer.on('file-opened', (_: any, error: Error, currentFileName: string, data: string) => {
    if (error) {
        alertError(error);
    } else {
        document.title = currentFileName;
        editorInstance.setValue(data);
        modelVersion = editorInstance.getModel()
            .getAlternativeVersionId();

        resetFooter();
    }
});

ipcRenderer.on('undo', (_: any) => {
    editorInstance.trigger('', 'undo', '');
});

ipcRenderer.on('redo', (_: any) => {
    editorInstance.trigger('', 'redo', '');
});

ipcRenderer.on('find', (_: any) => {
    editorInstance.trigger('', 'find', '');
});

ipcRenderer.on('replace', (_: any) => {
    editorInstance.trigger('', 'replace', '');
});

ipcRenderer.on('dark-mode-toggled', (_: any, useDarkColors: boolean) => {
    const theme: string = (useDarkColors) ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);

    if (editorInstance) {
        monaco.editor.setTheme(createLyricistantTheme(monaco, useDarkColors));
    }
    if (wavesurfer) {
        wavesurfer.setWaveColor(getCssColor('--tertiary-text-color'));
        // tslint:disable-next-line: no-unsafe-any
        wavesurfer.setProgressColor(getCssColor('--selected-item-background-color'));
    }
});

ipcRenderer.on('reference-data-changed', (_: any, data: ReferencedData | null) => {
    if (!data) {
        resetFooter();

        return;
    }

    associateFileButton.hidden = true;

    if (data.dataType !== 'file' ||
        !(getSupportedAudioFileExtensions()
            .includes(data.data.substring(data.data.lastIndexOf('.') + 1)))) {
        openExternallyButton.hidden = false;

        return;
    }

    openExternallyButton.hidden = true;
    audioContainer.style.display = 'grid';

    if (data.dataType === 'file') {
        wavesurfer = WaveSurfer.create({
            backend: 'WebAudio',
            container: '#wavesurfer',
            height: 48,
            barWidth: 2,
            waveColor: getCssColor('--tertiary-text-color'),
            progressColor: getCssColor('--audio-color'),
            pixelRatio: 1,
            responsive: true,
            normalize: true
        });
        wavesurfer.on('ready', () => {
            editorInstance.layout();
        });
        wavesurfer.on('error', () => {
            openExternallyButton.hidden = false;
            audioContainer.style.display = 'none';
        });
        wavesurfer.on('play', () => {
            playPauseButton.classList.remove('paused');
            playPauseButton.classList.add('playing');
        });
        wavesurfer.on('pause', () => {
            playPauseButton.classList.remove('playing');
            playPauseButton.classList.add('paused');
        });

        wavesurfer.load(data.data);
    }
});

function attachRhymeCompleter(): void {
    const rhymeTable: HTMLTableElement = <HTMLTableElement>document.getElementById('rhyme-table');
    fromEventPattern((handler: NodeEventHandler) => editorInstance.onDidChangeCursorPosition(handler));
    const cursorChanges: Observable<WordAtPosition> =
        fromEventPattern((handler: NodeEventHandler) => editorInstance.onDidChangeCursorPosition(handler))
            .pipe(
                map((): WordAtPosition => {
                    const cursorPosition: IPosition = editorInstance.getPosition();
                    const wordAndColumns: editor.IWordAtPosition | null = editorInstance.getModel()
                        .getWordAtPosition(cursorPosition);

                    if (!wordAndColumns) {
                        return undefined;
                    }

                    return {
                        word: wordAndColumns.word,
                        range: new monaco.Range(
                            cursorPosition.lineNumber,
                            wordAndColumns.startColumn,
                            cursorPosition.lineNumber,
                            wordAndColumns.endColumn
                        )
                    };
                }),
                filter((value: WordAtPosition) => !!value)
            );
    const selectionChanges: Observable<WordAtPosition> =
        fromEventPattern((handler: NodeEventHandler) => editorInstance.onDidChangeCursorSelection(handler))
            .pipe(
                map(() => {
                    const selectionRange: IRange = editorInstance.getSelection();

                    return {
                        word: editorInstance.getModel()
                            .getValueInRange(selectionRange),
                        range: selectionRange

                    };
                }),
                filter((value: WordAtPosition) => {
                    return value.word.length > 1 &&
                        value
                            .word
                            .charAt(0)
                            .match(/\w/) !== undefined;
                })
            );
    merge(selectionChanges, cursorChanges)
        .pipe(
            distinctUntilChanged(),
            debounceTime(200),
            switchMap((data: WordAtPosition) =>
                fetchRhymes(data.word)
                    .pipe(
                        map((rhymes: Rhyme[]) => {
                            return {
                                searchedWordData: data,
                                rhymes: rhymes
                            };
                        })
                    )
            ),
            tap(() => {
                while (rhymeTable.hasChildNodes()) {
                    rhymeTable.removeChild(rhymeTable.lastChild);
                }
            })
        )
        .subscribe((result: { searchedWordData: WordAtPosition; rhymes: Rhyme[] }): void => {
            result.rhymes.forEach((rhyme: Rhyme) => {
                const row: HTMLTableRowElement = rhymeTable.insertRow(-1);
                const cell: HTMLTableCellElement = row.insertCell();
                cell.appendChild(document.createTextNode(rhyme.word));
                cell.onclick = (): void => {
                    editorInstance.focus();
                    const op: editor.IIdentifiedSingleEditOperation = {
                        range: new monaco.Range(
                            result.searchedWordData.range.startLineNumber,
                            result.searchedWordData.range.startColumn,
                            result.searchedWordData.range.endLineNumber,
                            result.searchedWordData.range.endColumn
                        ),
                        text: rhyme.word,
                        forceMoveMarkers: true
                    };
                    editorInstance.executeEdits('', [op]);
                };
            });
        });
}

function setupNewFile(): void {
    document.title = 'Untitled';
    editorInstance.setValue('');

    resetFooter();

    ipcRenderer.send('new-file-created');

    modelVersion = editorInstance
        .getModel()
        .getAlternativeVersionId();
}

function setupAssociateFileSection(): void {
    associateFileButton.onclick = (): void => {
        ipcRenderer.send('choose-reference-file');
    };
    openExternallyButton.onclick = (): void => {
        ipcRenderer.send('open-referenced-file-external');
    };
    document.getElementById('remove-association').onclick = (): void => {
        ipcRenderer.send('remove-reference-data');
    }
    tippy(associateFileButton, {
        content: 'Choose a file to be associated with these lyrics. If the file is an audio file, it can be played here.',
        theme: 'material'
    });
    playPauseButton.onclick = (): void => {
        // This won't return a promise since we're using the WebAudio backend.
        // tslint:disable-next-line: no-floating-promises
        wavesurfer.playPause();
    };
}

function resetFooter(): void {
    wavesurfer?.destroy();
    playPauseButton.classList.remove('playing');
    playPauseButton.classList.add('paused');
    associateFileButton.hidden = false;
    openExternallyButton.hidden = true;
    audioContainer.style.display = 'none';
    editorInstance.layout();
}

function alertError(error: NodeJS.ErrnoException): void {
    alert(`Error: ${error.message}`);
}

function showSnackbar(message: string): void {
    Snackbar.show({
        text: message,
        pos: 'bottom-left',
        duration: 3000,
        showAction: false
    });
}

interface WordAtPosition {
    range: IRange;
    word: string;
}
