'use client';

import { ListMirrorsResponse, PeerSlotResponse, SlotInfo, ListMirrorsItem, CDCBatch, MirrorLog } from '@/grpc_generated/route';
import { Header } from '@/lib/Header';
import { LayoutMain } from '@/lib/Layout';
import { Panel } from '@/lib/Panel';
import { ProgressCircle } from '@/lib/ProgressCircle';
import { Table, TableCell, TableRow } from '@/lib/Table';
import { Label } from '@/lib/Label';
import { Badge } from '@/lib/Badge';
import { BadgeVariant } from '@/lib/Badge/Badge.styles';
import { Button } from '@/lib/Button';
import { Icon } from '@/lib/Icon';
import { FlowStatus } from '@/grpc_generated/flow';
import MirrorLink from '@/components/MirrorLink';
import TimeLabel from '@/components/TimeComponent';
import { FormatStatus } from '@/app/utils/flowstatus';
import { notifyErr } from '@/app/utils/notify';
import useSWR from 'swr';
import { fetcher } from '../../utils/swr';
import { useEffect, useState, useMemo } from 'react';
import { changeFlowState, resyncMirror } from '../[mirrorId]/handlers';
import styled, { keyframes } from 'styled-components';
import * as RadixDialog from '@radix-ui/react-dialog';

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideIn = keyframes`
  from { transform: translate(-50%, -48%) scale(0.96); opacity: 0; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
`;

const DialogOverlay = styled(RadixDialog.Overlay)`
    background-color: rgba(15, 23, 42, 0.6);
    position: fixed;
    inset: 0;
    backdrop-filter: blur(8px);
    z-index: 1000;
    animation: ${fadeIn} 0.2s ease-out;
`;

const DialogContent = styled(RadixDialog.Content)`
    background-color: #ffffff;
    border-radius: 16px;
    box-shadow: 
        0 20px 25px -5px rgba(0, 0, 0, 0.1),
        0 10px 10px -5px rgba(0, 0, 0, 0.04),
        0 0 0 1px rgba(0, 0, 0, 0.05);
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 90vw;
    max-width: 440px;
    padding: 28px;
    z-index: 1001;
    animation: ${slideIn} 0.2s ease-out;
    border: 1px solid #f1f5f9;
    outline: none;
`;

const WarningHeader = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
    color: #dc2626;
`;

const WarningIconBox = styled.div`
    background: #fee2e2;
    padding: 8px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
`;

const BigWarningIcon = styled(Icon)`
    font-size: 24px !important;
    color: #dc2626;
`;

const ModalTitle = styled(RadixDialog.Title)`
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #0f172a;
`;

const ModalDescription = styled(RadixDialog.Description)`
    margin: 0 0 24px 0;
    color: #64748b;
    font-size: 14px;
    line-height: 1.6;
`;

const ButtonGroup = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: 12px;
`;

const LogContainer = styled.div`
    max-height: 80px;
    overflow-y: auto;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 11px;
    line-height: 1.4;
    padding: 4px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #059669; /* info green */
    &.error {
        color: #dc2626; /* error red */
    }
    &::-webkit-scrollbar {
        width: 4px;
    }
    &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 2px;
    }
`;

const ActionWrapper = styled.div`
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    align-items: center;
`;

const StyledPanel = styled(Panel)`
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    &:hover {
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    }
`;

const SortIcon = styled(Icon)`
    font-size: 14px !important;
    color: #3b82f6;
`;

const RefreshIcon = styled(Icon)``;


function getStatusVariant(status: FlowStatus): BadgeVariant {
    const statusStr = status.toString();
    switch (statusStr) {
        case FlowStatus[FlowStatus.STATUS_RUNNING]:
            return 'positive';
        case FlowStatus[FlowStatus.STATUS_PAUSED]:
        case FlowStatus[FlowStatus.STATUS_PAUSING]:
            return 'warning';
        case FlowStatus[FlowStatus.STATUS_FAILED]:
        case FlowStatus[FlowStatus.STATUS_TERMINATED]:
        case FlowStatus[FlowStatus.STATUS_TERMINATING]:
            return 'destructive';
        default:
            return 'normal';
    }
}

function getFlowNameFromSlot(slotName: string): string {
    if (slotName.startsWith('peerflow_slot_')) {
        return slotName.slice(14);
    }
    return '';
}

interface ExtendedMirrorItem extends ListMirrorsItem {
    lagInMb?: number;
    slotActive?: boolean;
    latestStartTime?: string;
    lastSuccessfulEndTime?: string;
    rowsCopied?: number;
    lastLog?: MirrorLog;
}

export default function MirrorsDashboard() {
    const {
        data: flowsData,
        isLoading: isFlowsLoading,
        mutate: mutateFlows,
    } = useSWR<ListMirrorsResponse>('/api/v1/mirrors/list', fetcher);

    const [mirrorDetails, setMirrorDetails] = useState<Record<string, Partial<ExtendedMirrorItem>>>({});
    const [isDetailsLoading, setIsDetailsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [resyncMirrorName, setResyncMirrorName] = useState<string | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'lag', direction: 'desc' });

    const mirrors = useMemo(() => flowsData?.mirrors || [], [flowsData]);

    useEffect(() => {
        if (mirrors.length === 0) return;

        const fetchDetails = async () => {
            setIsDetailsLoading(true);
            const detailsMap: Record<string, Partial<ExtendedMirrorItem>> = {};

            const sourcePeers = Array.from(new Set(mirrors.map(m => m.sourceName)));
            const slotsByPeer: Record<string, SlotInfo[]> = {};

            await Promise.all([
                ...sourcePeers.map(async (peerName) => {
                    try {
                        const res = await fetch(`/api/v1/peers/slots/${peerName}`, { cache: 'no-store' });
                        if (res.ok) {
                            const data: PeerSlotResponse = await res.json();
                            slotsByPeer[peerName] = data.slotData ?? [];
                        }
                    } catch (e) {
                        console.error(`Error fetching slots for peer ${peerName}:`, e);
                    }
                }),
                ...mirrors.map(async (mirror: ListMirrorsItem) => {
                    const detail: Partial<ExtendedMirrorItem> = {};

                    try {
                        const logsRes = await fetch('/api/v1/mirrors/logs', {
                            method: 'POST',
                            body: JSON.stringify({
                                flowJobName: mirror.name,
                                level: 'all',
                                numPerPage: 1,
                                page: 0
                            })
                        });
                        if (logsRes.ok) {
                            const logsData = await logsRes.json();
                            if (logsData.errors && logsData.errors.length > 0) {
                                detail.lastLog = logsData.errors[0];
                            }
                        }

                        if (mirror.isCdc) {
                            const batchesRes = await fetch('/api/v1/mirrors/cdc/batches', {
                                method: 'POST',
                                body: JSON.stringify({
                                    flowJobName: mirror.name,
                                    limit: 5,
                                    ascending: false
                                })
                            });
                            if (batchesRes.ok) {
                                const batchesData = await batchesRes.json();
                                const batches: CDCBatch[] = batchesData.cdcBatches || [];

                                // Latest in-progress batch
                                const inProgress = batches.find(b => b.endTime === undefined || b.endTime === null);
                                if (inProgress) {
                                    detail.latestStartTime = new Date(inProgress.startTime as any).toISOString();
                                }

                                // Last successful batch
                                const lastSuccessful = batches.find(b => b.endTime !== undefined && b.endTime !== null);
                                if (lastSuccessful) {
                                    detail.lastSuccessfulEndTime = new Date(lastSuccessful.endTime as any).toISOString();
                                    detail.rowsCopied = lastSuccessful.numRows;
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`Error fetching details for mirror ${mirror.name}:`, e);
                    }
                    detailsMap[mirror.name] = detail;
                })
            ]);

            mirrors.forEach(mirror => {
                const slots = slotsByPeer[mirror.sourceName] || [];
                const matchingSlot = slots.find((s: SlotInfo) => getFlowNameFromSlot(s.slotName) === mirror.name);
                if (matchingSlot) {
                    if (!detailsMap[mirror.name]) detailsMap[mirror.name] = {};
                    detailsMap[mirror.name]!.lagInMb = matchingSlot.lagInMb;
                    detailsMap[mirror.name]!.slotActive = matchingSlot.active;
                }
            });

            setMirrorDetails(detailsMap);
            setIsDetailsLoading(false);
        };

        fetchDetails();
    }, [mirrors]);

    const handleAction = async (mirrorName: string, action: 'pause' | 'resume' | 'resync') => {
        if (action === 'resync') {
            setResyncMirrorName(mirrorName);
            return;
        }

        setActionLoading(mirrorName);
        try {
            if (action === 'pause') {
                await changeFlowState(mirrorName, FlowStatus.STATUS_PAUSED);
                notifyErr('Mirror paused successfully', true);
            } else if (action === 'resume') {
                await changeFlowState(mirrorName, FlowStatus.STATUS_RUNNING);
                notifyErr('Mirror resumed successfully', true);
            }
            mutateFlows();
        } catch (e: any) {
            notifyErr(e.message || `Failed to ${action} mirror`);
        } finally {
            setActionLoading(null);
        }
    };

    const performResync = async () => {
        if (!resyncMirrorName) return;
        setActionLoading(resyncMirrorName);
        try {
            await resyncMirror(resyncMirrorName);
            notifyErr('Mirror resync initiated', true);
            setResyncMirrorName(null);
            mutateFlows();
        } catch (e: any) {
            notifyErr(e.message || 'Failed to resync mirror');
        } finally {
            setActionLoading(null);
        }
    };


    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const mergedMirrors = useMemo(() => {
        const result = mirrors.map((mirror): ExtendedMirrorItem => {
            const details = mirrorDetails[mirror.name] || {};
            return {
                ...mirror,
                ...details
            };
        });

        if (sortConfig) {
            result.sort((a: ExtendedMirrorItem, b: ExtendedMirrorItem) => {
                let valA: any, valB: any;
                switch (sortConfig.key) {
                    case 'name':
                        valA = a.name;
                        valB = b.name;
                        break;
                    case 'status':
                        valA = FormatStatus(a.status);
                        valB = FormatStatus(b.status);
                        break;
                    case 'lag':
                        valA = a.lagInMb || 0;
                        valB = b.lagInMb || 0;
                        break;
                    case 'lastSync':
                        valA = a.lastSuccessfulEndTime ? new Date(a.lastSuccessfulEndTime).getTime() : 0;
                        valB = b.lastSuccessfulEndTime ? new Date(b.lastSuccessfulEndTime).getTime() : 0;
                        break;
                    case 'nextSync':
                        valA = a.latestStartTime ? new Date(a.latestStartTime).getTime() : 0;
                        valB = b.latestStartTime ? new Date(b.latestStartTime).getTime() : 0;
                        break;
                    case 'rows':
                        valA = a.rowsCopied || 0;
                        valB = b.rowsCopied || 0;
                        break;
                    case 'sourceName':
                        valA = a.sourceName;
                        valB = b.sourceName;
                        break;
                    case 'destinationName':
                        valA = a.destinationName;
                        valB = b.destinationName;
                        break;
                    case 'isCdc':
                        valA = a.isCdc ? 1 : 0;
                        valB = b.isCdc ? 1 : 0;
                        break;
                    case 'slotActive':
                        valA = a.slotActive ? 1 : 0;
                        valB = b.slotActive ? 1 : 0;
                        break;
                    case 'log':
                        valA = a.lastLog?.errorMessage || '';
                        valB = b.lastLog?.errorMessage || '';
                        break;
                    default:
                        return 0;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [mirrors, mirrorDetails, sortConfig]);

    const isLoading = isFlowsLoading || (isDetailsLoading && Object.keys(mirrorDetails).length === 0);

    return (
        <LayoutMain alignSelf='flex-start' justifySelf='flex-start' width='full' style={{ padding: '24px', background: '#f8fafc' }}>
            <StyledPanel>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <Header variant='title2' style={{ marginBottom: '8px', color: '#1e293b' }}>Mirrors Dashboard</Header>
                        <Label variant='footnote' style={{ color: '#64748b' }}>
                            Comprehensive view of all mirrors with real-time lag, sync history, and status logs.
                        </Label>
                    </div>
                    <Button variant='normalSolid' onClick={() => mutateFlows()} style={{ borderRadius: '8px', padding: '10px 20px' }}>
                        <RefreshIcon name='refresh' />
                        Refresh Data
                    </Button>
                </div>
            </StyledPanel>

            {isLoading ? (
                <Panel style={{ marginTop: '20px' }}>
                    <div className='h-64 flex items-center justify-center'>
                        <ProgressCircle variant='determinate_progress_circle' />
                    </div>
                </Panel>
            ) : (
                <StyledPanel className='mt-5'>
                    <Table
                        header={
                            <TableRow>
                                {[
                                    { label: 'Mirror Name', id: 'name' },
                                    { label: 'Status', id: 'status' },
                                    { label: 'Lag (MB)', id: 'lag' },
                                    { label: 'Last Successful Sync', id: 'lastSync' },
                                    { label: 'Next Sync Start Time', id: 'nextSync' },
                                    { label: 'Rows Copied', id: 'rows' },
                                    { label: 'Last Log / Error', id: 'log' },
                                    { label: 'Actions', id: 'actions' },
                                    { label: 'Resync (Be Careful)', id: 'resync' }
                                ].map((heading, index) => (
                                    <TableCell
                                        as='th'
                                        key={index}
                                        style={{
                                            textAlign: heading.id === 'actions' || heading.id === 'resync' ? 'center' : 'left',
                                            borderBottom: '2px solid #e2e8f0',
                                            cursor: !['log', 'actions', 'resync'].includes(heading.id) ? 'pointer' : 'default',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => !['log', 'actions', 'resync'].includes(heading.id) && handleSort(heading.id)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: heading.id === 'actions' || heading.id === 'resync' ? 'center' : 'flex-start' }}>
                                            <Label as='label' style={{ fontWeight: 800, fontSize: '11px', textTransform: 'uppercase', color: '#64748b' }}>
                                                {heading.label}
                                            </Label>
                                            {sortConfig?.key === heading.id && (
                                                <SortIcon
                                                    name={sortConfig.direction === 'asc' ? 'expand_less' : 'expand_more'}
                                                />
                                            )}
                                        </div>
                                    </TableCell>
                                ))}
                            </TableRow>
                        }
                    >
                        {mergedMirrors.map((flow: ExtendedMirrorItem) => {
                            const diffTime = flow.lastSuccessfulEndTime ? (new Date().getTime() - new Date(flow.lastSuccessfulEndTime).getTime()) : 0;
                            const isStale1h = diffTime > 3600000;
                            const isStale24h = diffTime > 86400000;

                            return (
                                <TableRow key={flow.id}>
                                    <TableCell variant='mirror_name'>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <MirrorLink flowName={flow.name} />
                                            <Label variant='footnote' style={{ marginTop: '4px', opacity: 0.6, fontSize: '11px' }}>
                                                {flow.sourceName} ➔ {flow.destinationName}
                                            </Label>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <Label style={{
                                                fontWeight: 800,
                                                color: FormatStatus(flow.status).toUpperCase() === 'RUNNING' ? '#22c55e' : '#ef4444'
                                            }}>
                                                {FormatStatus(flow.status).toUpperCase()}
                                            </Label>
                                            {flow.isCdc && (
                                                <Label variant='footnote' style={{ fontSize: '9px', fontWeight: 600, color: flow.slotActive ? '#166534' : '#991b1b' }}>
                                                    {flow.slotActive ? 'ACTIVE SLOT' : 'INACTIVE SLOT'}
                                                </Label>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {flow.isCdc ? (
                                            <Label style={{
                                                fontSize: '14px',
                                                fontWeight: flow.lagInMb && flow.lagInMb > 100 ? 700 : 500,
                                                color: flow.lagInMb && flow.lagInMb > 100 ? '#ef4444' : '#334155'
                                            }}>
                                                {flow.lagInMb !== undefined ? `${flow.lagInMb < 0 ? 0 : flow.lagInMb.toFixed(2)} MB` : 'N/A'}
                                            </Label>
                                        ) : (
                                            <Label variant='footnote' style={{ opacity: 0.3 }}>—</Label>
                                        )}
                                    </TableCell>
                                    <TableCell style={{
                                        background: isStale24h ? '#fee2e2' : (isStale1h ? '#fef3c7' : 'transparent'),
                                        transition: 'background 0.3s ease'
                                    }}>
                                        {flow.lastSuccessfulEndTime ? (
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <TimeLabel timeVal={new Date(flow.lastSuccessfulEndTime)} />
                                                {isStale24h && <Badge variant='destructive' style={{ fontSize: '8px', marginTop: '4px' }}>STALE 24H</Badge>}
                                                {isStale1h && !isStale24h && <Badge variant='warning' style={{ fontSize: '8px', marginTop: '4px' }}>STALE 1H</Badge>}
                                            </div>
                                        ) : (
                                            <Label variant='footnote' style={{ opacity: 0.3 }}>—</Label>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {flow.latestStartTime ? (
                                            <TimeLabel timeVal={new Date(flow.latestStartTime)} />
                                        ) : (
                                            <Label variant='footnote' style={{ opacity: 0.3 }}>—</Label>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Label style={{ fontWeight: 600 }}>{flow.rowsCopied?.toLocaleString() || '0'}</Label>
                                    </TableCell>
                                    <TableCell style={{ width: '320px' }}>
                                        {flow.lastLog ? (
                                            <LogContainer className={flow.lastLog.errorType === 'error' ? 'error' : ''} title={flow.lastLog.errorMessage}>
                                                {flow.lastLog.errorMessage}
                                            </LogContainer>
                                        ) : (
                                            <Label variant='footnote' style={{ opacity: 0.4, fontStyle: 'italic' }}>No logs available</Label>
                                        )}
                                    </TableCell>
                                    <TableCell style={{ textAlign: 'center' }}>
                                        {FormatStatus(flow.status).toUpperCase() === 'RUNNING' ? (
                                            <Button
                                                variant='normal'
                                                size='small'
                                                onClick={() => handleAction(flow.name, 'pause')}
                                                disabled={actionLoading === flow.name}
                                                style={{ padding: '4px 12px', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                                            >
                                                Pause
                                            </Button>
                                        ) : FormatStatus(flow.status).toUpperCase() === 'PAUSED' ? (
                                            <Button
                                                variant='normalSolid'
                                                size='small'
                                                onClick={() => handleAction(flow.name, 'resume')}
                                                disabled={actionLoading === flow.name}
                                                style={{ padding: '4px 12px', borderRadius: '4px' }}
                                            >
                                                Resume
                                            </Button>
                                        ) : null}
                                    </TableCell>
                                    <TableCell style={{ textAlign: 'center' }}>
                                        <Button
                                            variant='destructive'
                                            size='small'
                                            onClick={() => handleAction(flow.name, 'resync')}
                                            disabled={actionLoading === flow.name}
                                            style={{
                                                background: '#ef4444',
                                                color: '#fff',
                                                fontWeight: 'bold',
                                                padding: '4px 12px',
                                                borderRadius: '4px'
                                            }}
                                        >
                                            RESYNC
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </Table>
                </StyledPanel>
            )}

            <RadixDialog.Root
                open={!!resyncMirrorName}
                onOpenChange={(open: boolean) => !open && setResyncMirrorName(null)}
            >
                <RadixDialog.Portal>
                    <DialogOverlay />
                    <DialogContent>
                        <WarningHeader>
                            <WarningIconBox>
                                <BigWarningIcon name="warning" />
                            </WarningIconBox>
                            <ModalTitle>Confirm Resync</ModalTitle>
                        </WarningHeader>

                        <ModalDescription>
                            Are you sure you want to resync <strong>{resyncMirrorName}</strong>?
                            <br /><br />
                            This will drop existing mirror stats and recreate it with a fresh initial load. This action is significant and may take time depending on data volume.
                        </ModalDescription>

                        <ButtonGroup>
                            <RadixDialog.Close asChild>
                                <Button variant="normal" style={{ borderRadius: '8px' }}>
                                    Cancel
                                </Button>
                            </RadixDialog.Close>
                            <Button
                                variant="destructive"
                                onClick={performResync}
                                disabled={!!actionLoading}
                                style={{
                                    borderRadius: '8px',
                                    background: '#dc2626',
                                    color: '#ffffff',
                                    fontWeight: 'bold',
                                    paddingLeft: '20px',
                                    paddingRight: '20px'
                                }}
                            >
                                {actionLoading ? 'Resyncing...' : 'Yes, Resync Now'}
                            </Button>
                        </ButtonGroup>
                    </DialogContent>
                </RadixDialog.Portal>
            </RadixDialog.Root>
        </LayoutMain>
    );
}
