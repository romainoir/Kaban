import React from 'react';

const RefugeCardSkeleton = ({ layout = 'grid' }) => {
    const isList = layout === 'list';

    return (
        <div
            className="glass-panel"
            style={{
                overflow: 'hidden',
                display: 'flex',
                flexDirection: isList ? 'row' : 'column',
                height: isList ? '160px' : '400px',
                background: 'var(--card-bg)',
                border: '1px solid var(--card-border)',
                borderRadius: '16px',
                animation: 'pulse 1.5s ease-in-out infinite',
            }}
        >
            <div
                style={{
                    width: isList ? '180px' : '100%',
                    minWidth: isList ? '180px' : 'auto',
                    height: isList ? '100%' : '200px',
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                }}
            />

            <div
                style={{
                    padding: '1rem',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                }}
            >
                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{
                        width: '60px',
                        height: '18px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.1)',
                    }} />
                    <div style={{
                        width: '70px',
                        height: '18px',
                        borderRadius: '12px',
                        background: 'rgba(255,255,255,0.1)',
                    }} />
                </div>

                <div style={{
                    width: '70%',
                    height: isList ? '20px' : '24px',
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.15)',
                }} />

                <div style={{
                    width: '40%',
                    height: '16px',
                    borderRadius: '6px',
                    background: 'rgba(255,255,255,0.1)',
                }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ width: '100%', height: '14px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />
                    <div style={{ width: '90%', height: '14px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />
                    {!isList && <div style={{ width: '80%', height: '14px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }} />}
                </div>
            </div>
        </div>
    );
};

export default RefugeCardSkeleton;
