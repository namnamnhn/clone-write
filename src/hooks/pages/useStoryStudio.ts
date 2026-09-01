import { useMemo, useState } from 'react';
import { buildStoryStudioViewModel } from '../../storyStudio/storyStudioPresenter';
import { EMPTY_STORY_STUDIO_SESSION, STORY_STUDIO_DEMO_VIEW_MODEL } from '../../storyStudio/storyStudioDemoViewModel';

export const useStoryStudio = () => {
    const [showDemo, setShowDemo] = useState(false);
    const viewModel = useMemo(
        () => showDemo ? STORY_STUDIO_DEMO_VIEW_MODEL : buildStoryStudioViewModel(EMPTY_STORY_STUDIO_SESSION),
        [showDemo],
    );

    return {
        showDemo,
        setShowDemo,
        viewModel,
    };
};
