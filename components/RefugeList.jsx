import React from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import RefugeCard from './RefugeCard';

const FixedSizeList = ReactWindow.FixedSizeList;

const RefugeList = ({
    refuges,
    onSelectRefuge,
    onHoverRefuge,
    onHoverEndRefuge,
    likedRefuges,
    starredRefuges,
    dislikedRefuges,
    onToggleLike,
    onToggleStar,
    onToggleDislike,
    layout = 'list',
}) => {
    const itemHeight = layout === 'list' ? 176 : 416;

    const Row = ({ index, style }) => {
        const refuge = refuges[index];
        return (
            <div style={{ ...style, paddingBottom: '1rem' }}>
                <RefugeCard
                    refuge={refuge}
                    score={refuge.matchScore}
                    onSelect={onSelectRefuge}
                    layout={layout}
                    isLiked={likedRefuges.includes(refuge.properties.id)}
                    onToggleLike={() => onToggleLike(refuge.properties.id)}
                    isStarred={starredRefuges.includes(refuge.properties.id)}
                    onToggleStar={() => onToggleStar(refuge.properties.id)}
                    isDisliked={dislikedRefuges.includes(refuge.properties.id)}
                    onToggleDislike={() => onToggleDislike(refuge.properties.id)}
                    onHover={() => onHoverRefuge(refuge.properties.id)}
                    onHoverEnd={onHoverEndRefuge}
                />
            </div>
        );
    };

    return (
        <AutoSizer>
            {({ height, width }) => (
                <FixedSizeList
                    height={height}
                    itemCount={refuges.length}
                    itemSize={itemHeight}
                    width={width}
                    overscanCount={2}
                >
                    {Row}
                </FixedSizeList>
            )}
        </AutoSizer>
    );
};

export default RefugeList;
