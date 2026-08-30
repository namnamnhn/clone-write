// Thin composer: combines the smaller per-concern handler hooks in
// `hooks/appHandlers/` into the single object App.tsx expects. This used
// to be one 849-line file with ~25 unrelated handlers; the logic itself is
// unchanged, only split by concern (cleanup, dictionary, AI context
// analysis, file-list CRUD, downloads, uploads) so each piece is easier to
// find and fix in isolation.
import { useCleanupHandlers } from './appHandlers/useCleanupHandlers';
import { useDictionaryHandlers } from './appHandlers/useDictionaryHandlers';
import { useContextAnalysisHandlers } from './appHandlers/useContextAnalysisHandlers';
import { useFileListHandlers } from './appHandlers/useFileListHandlers';
import { useDownloadHandlers } from './appHandlers/useDownloadHandlers';
import { useUploadHandlers } from './appHandlers/useUploadHandlers';
import type { CoreApi, UIApi } from './apiTypes';

export const useAppHandlers = (
    core: CoreApi,
    ui: UIApi,
    fileHandler: any,
    engine: any,
    automation: any
) => {
    const cleanup = useCleanupHandlers(core, ui);
    const dictionary = useDictionaryHandlers(core, ui);
    const contextAnalysis = useContextAnalysisHandlers(core, ui, automation);
    const fileList = useFileListHandlers(core, ui);
    const download = useDownloadHandlers(core, ui);
    const upload = useUploadHandlers(core, ui, fileHandler);

    return {
        ...cleanup,
        ...dictionary,
        ...contextAnalysis,
        ...fileList,
        ...download,
        ...upload,
    };
};
