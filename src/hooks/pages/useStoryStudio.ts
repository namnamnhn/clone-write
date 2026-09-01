import { useMemo, useState } from 'react';
import { buildStoryStudioViewModel } from '../../storyStudio/storyStudioPresenter';
import { EMPTY_STORY_STUDIO_SESSION, STORY_STUDIO_DEMO_SESSION } from '../../storyStudio/storyStudioDemoSession';

export const useStoryStudio = () => {
    const [showDemo, setShowDemo] = useState(false);
    const session = showDemo ? STORY_STUDIO_DEMO_SESSION : EMPTY_STORY_STUDIO_SESSION;
    const viewModel = useMemo(() => buildStoryStudioViewModel(session), [session]);

    return {
        showDemo,
        setShowDemo,
        viewModel,
    };
};
