'use client';

import { PeerSlotResponse, ListPeersResponse, SlotInfo, PeerListItem, GetSlotLagHistoryResponse } from '@/grpc_generated/route';
import { Header } from '@/lib/Header';
import { LayoutMain } from '@/lib/Layout';
import { Panel } from '@/lib/Panel';
import { ProgressCircle } from '@/lib/ProgressCircle';
import { Table, TableCell, TableRow } from '@/lib/Table';
import { Label } from '@/lib/Label';
import { Badge } from '@/lib/Badge';
import { Button } from '@/lib/Button';
import { Icon } from '@/lib/Icon';
import PeerButton from '@/components/PeerComponent';
import useSWR from 'swr';
import { fetcher } from '../../utils/swr';
import { useEffect, useState, useMemo } from 'react';
import styled from 'styled-components';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

const StyledPanel = styled(Panel)`
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    &:hover {
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    }
`;

const LagIndicator = styled.div<{ lagMb: number }>`
    width: 100px;
    height: 8px;
    background: #e2e8f0;
    border-radius: 4px;
    overflow: hidden;
    margin-top: 4px;
    &::after {
        content: '';
        display: block;
        height: 100%;
        /* Calculate width: 0-1024MB maps to 0-100% */
        width: ${props => Math.min((props.lagMb / 1024) * 100, 100)}%;
        /* Dynamic color transition: Green (120deg) to Red (0deg) */
        background: ${props => {
        const hue = Math.max(0, 120 - (props.lagMb / 1024) * 120);
        return `hsl(${hue}, 75%, 45%)`;
    }};
        transition: width 0.5s ease, background 0.5s ease;
    }
`;

const ActionWrapper = styled.div`
    display: flex;
    justify-content: flex-end;
    align-items: center;
`;

const SortIcon = styled(Icon)`
    font-size: 16px !important;
    color: #3b82f6;
`;

const ChartIcon = styled(Icon)`
    color: #2563eb;
`;

const RefreshIcon = styled(Icon)``;

const InfoIcon = styled(Icon)`
    font-size: 32px !important;
    color: #cbd5e1;
    margin-bottom: 12px;
`;

interface FlatSlotItem {
    peerName: string;
    peerType: any;
    slot: SlotInfo;
}

export default function PeersDashboard() {
    const {
        data: peersData,
        isLoading: isPeersLoading,
        mutate: mutatePeers,
    } = useSWR<ListPeersResponse>('/api/v1/peers/list', fetcher);

    const [peerSlots, setPeerSlots] = useState<Record<string, SlotInfo[]>>({});
    const [isSlotsLoading, setIsSlotsLoading] = useState(false);
    const [selectedPeerForHistory, setSelectedPeerForHistory] = useState<string | null>(null);
    const [historyData, setHistoryData] = useState<any>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'lag', direction: 'desc' });

    const peers = useMemo(() => peersData?.items || [], [peersData]);

    useEffect(() => {
        if (peers.length === 0) return;

        const fetchAllSlots = async () => {
            setIsSlotsLoading(true);
            const slotsMap: Record<string, SlotInfo[]> = {};
            await Promise.all(
                peers.map(async (peer: PeerListItem) => {
                    try {
                        const res = await fetch(`/api/v1/peers/slots/${peer.name}`, { cache: 'no-store' });
                        if (res.ok) {
                            const data: PeerSlotResponse = await res.json();
                            slotsMap[peer.name] = data.slotData ?? [];
                        }
                    } catch (e) {
                        console.error(`Error fetching slots for peer ${peer.name}:`, e);
                    }
                })
            );
            setPeerSlots(slotsMap);
            setIsSlotsLoading(false);
        };

        fetchAllSlots();
    }, [peers]);

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const fetchHistory = async (peerName: string, slotName: string) => {
        try {
            const res = await fetch('/api/v1/peers/slots/lag_history', {
                method: 'POST',
                body: JSON.stringify({
                    peerName,
                    slotName,
                    timeSince: '1day'
                })
            });
            if (res.ok) {
                const data: GetSlotLagHistoryResponse = await res.json();
                const sortedData = (data.data || []).sort((a: any, b: any) => Number(a.time) - Number(b.time));

                setHistoryData({
                    labels: sortedData.map((p: any) => new Date(Number(p.time)).toLocaleTimeString()),
                    datasets: [
                        {
                            label: `Lag (MB)`,
                            data: sortedData.map((p: any) => p.size),
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 2,
                        },
                    ],
                });
                setSelectedPeerForHistory(`${peerName} - ${slotName}`);
            }
        } catch (e) {
            console.error('Error fetching history:', e);
        }
    };

    const flatSlots = useMemo(() => {
        const allSlots: FlatSlotItem[] = [];
        peers.forEach((peer: PeerListItem) => {
            const slots = peerSlots[peer.name] || [];
            slots.forEach((slot: SlotInfo) => {
                allSlots.push({
                    peerName: peer.name,
                    peerType: peer.type,
                    slot: slot,
                });
            });
        });

        if (sortConfig) {
            allSlots.sort((a: FlatSlotItem, b: FlatSlotItem) => {
                let valA: any, valB: any;
                switch (sortConfig.key) {
                    case 'peer':
                        valA = a.peerName;
                        valB = b.peerName;
                        break;
                    case 'slot':
                        valA = a.slot.slotName;
                        valB = b.slot.slotName;
                        break;
                    case 'status':
                        valA = a.slot.active;
                        valB = b.slot.active;
                        break;
                    case 'lag':
                        valA = a.slot.lagInMb || 0;
                        valB = b.slot.lagInMb || 0;
                        break;
                    default:
                        return 0;
                }

                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return allSlots;
    }, [peers, peerSlots, sortConfig]);

    const isLoading = isPeersLoading || (isSlotsLoading && Object.keys(peerSlots).length === 0);

    return (
        <LayoutMain alignSelf='flex-start' justifySelf='flex-start' width='full' style={{ padding: '24px', background: '#f8fafc' }}>
            <StyledPanel>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <Header variant='title2' style={{ marginBottom: '8px', color: '#1e293b' }}>Peers Dashboard</Header>
                        <Label variant='footnote' style={{ color: '#64748b' }}>Detailed replication slot monitoring across all configured peers.</Label>
                    </div>
                    <Button variant='normalSolid' onClick={() => mutatePeers()} style={{ borderRadius: '8px', padding: '10px 20px' }}>
                        <RefreshIcon name='refresh' />
                        Refresh Data
                    </Button>
                </div>
            </StyledPanel>

            {selectedPeerForHistory && historyData && (
                <StyledPanel className='mt-5' style={{ borderTop: '4px solid #3b82f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <div>
                            <Header variant='title3' style={{ color: '#1e293b' }}>Lag History</Header>
                            <Label variant='footnote' style={{ color: '#64748b' }}>Showing activity for <b>{selectedPeerForHistory}</b> (Last 24h)</Label>
                        </div>
                        <Button variant='normal' onClick={() => setSelectedPeerForHistory(null)} style={{ border: '1px solid #e2e8f0' }}>
                            Close Chart
                        </Button>
                    </div>
                    <div style={{ height: '300px' }}>
                        <Line
                            data={historyData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { display: false },
                                    tooltip: { backgroundColor: '#1e293b', titleColor: '#fff', bodyColor: '#fff', padding: 12 }
                                },
                                scales: {
                                    y: { beginAtZero: true, grid: { color: '#f1f5f9' }, border: { dash: [4, 4] } },
                                    x: { grid: { display: false } }
                                }
                            }}
                        />
                    </div>
                </StyledPanel>
            )}

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
                                    { label: 'Peer Name', id: 'peer' },
                                    { label: 'Slot Name', id: 'slot' },
                                    { label: 'Status', id: 'status' },
                                    { label: 'Replication Lag', id: 'lag' },
                                    { label: 'History', id: 'history' }
                                ].map((heading, index) => (
                                    <TableCell
                                        as='th'
                                        key={index}
                                        style={{
                                            textAlign: heading.id === 'history' ? 'right' : 'left',
                                            cursor: heading.id !== 'history' ? 'pointer' : 'default',
                                            userSelect: 'none'
                                        }}
                                        onClick={() => heading.id !== 'history' && handleSort(heading.id)}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: heading.id === 'history' ? 'flex-end' : 'flex-start' }}>
                                            <Label as='label' style={{ fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569' }}>
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
                        {flatSlots.map((item: any, idx: number) => (
                            <TableRow key={`${item.peerName}-${item.slot.slotName}-${idx}`}>
                                <TableCell>
                                    <PeerButton peerName={item.peerName} peerType={item.peerType} />
                                </TableCell>
                                <TableCell>
                                    <Label variant='footnote' style={{ fontStyle: 'italic', color: '#64748b' }}>{item.slot.slotName}</Label>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={item.slot.active ? 'positive' : 'warning'}>
                                        {item.slot.active ? 'ACTIVE' : 'INACTIVE'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <Label style={{
                                            fontSize: '14px',
                                            fontWeight: (item.slot.lagInMb || 0) > 100 ? 700 : 600,
                                            color: (item.slot.lagInMb || 0) > 100 ? '#ef4444' : '#334155'
                                        }}>
                                            {item.slot.lagInMb !== undefined ? `${item.slot.lagInMb.toFixed(2)} MB` : 'N/A'}
                                        </Label>
                                        <LagIndicator lagMb={item.slot.lagInMb || 0} />
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <ActionWrapper>
                                        <Button
                                            variant='normal'
                                            size='small'
                                            onClick={() => fetchHistory(item.peerName, item.slot.slotName)}
                                            style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: '6px' }}
                                        >
                                            <ChartIcon name='show_chart' />
                                        </Button>
                                    </ActionWrapper>
                                </TableCell>
                            </TableRow>
                        ))}
                        {flatSlots.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} style={{ textAlign: 'center', padding: '3rem' }}>
                                    <InfoIcon name='info' />
                                    <Label variant='footnote' style={{ opacity: 0.5 }}>No replication slots found for configured peers.</Label>
                                </TableCell>
                            </TableRow>
                        )}
                    </Table>
                </StyledPanel>
            )}
        </LayoutMain>
    );
}
