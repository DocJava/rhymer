class Header {
    public lyrics: boolean = true;
    public referencedData: ReferencedData | null;

    constructor(referencedData: ReferencedData | undefined) {
        // tslint:disable-next-line: no-null-keyword
        this.referencedData = referencedData ?? null;
    }
}

export class ReferencedData {
    public dataType: string;
    public data: string;

    constructor(dataType: string, data: string) {
        this.dataType = dataType;
        this.data = data;
    }
}

export function isValidHeader(text: string): boolean {
    try {
        // tslint:disable-next-line: no-unused-expression
        <Header>JSON.parse(text);

        return true;
    } catch {
        return false;
    }

}

export function createFileReference(filePath: string): string {
    return `${JSON.stringify(new Header(new ReferencedData('file', filePath)), undefined, 0)}\n`;
}

export function parseReferencedData(text: string): ReferencedData | null {
    if (!isValidHeader(text)) {
        throw Error(`Can't parse ${text} as ReferenceData`);
    }

    return (<Header>JSON.parse(text)).referencedData;
}

export function getSupportedAudioFileExtensions(): string[] {
    return ['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'wav'];
}
