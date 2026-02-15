import { GatewayReviewFile } from '../../shared-types/src';
export type ChangedLine = {
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    text: string;
};
export type ParsedDiff = {
    changedLines: ChangedLine[];
    lineSideIndex: Map<string, Map<number, 'LEFT' | 'RIGHT'>>;
    stats: {
        fileCount: number;
        changedLineCount: number;
        additions: number;
        deletions: number;
    };
};
export declare function extractChangedLinesFromPatch(path: string, patch: string): ChangedLine[];
export declare function parseDiffFiles(files: GatewayReviewFile[]): ParsedDiff;
