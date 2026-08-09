import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card,
  Table,
  Tag,
  Space,
  Button,
  Input,
  DatePicker,
  Select,
  Row,
  Col,
  Statistic,
  Timeline,
  Modal,
  Typography,
  Spin,
  Empty,
  Tooltip,
  Badge,
  Grid
} from 'antd';
import {
  SearchOutlined,
  FilterOutlined,
  HistoryOutlined,
  UserOutlined,
  EnvironmentOutlined,
  SwapOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useNotification } from '../hooks/useNotification';
import apiClient from '../utils/apiClient';

dayjs.extend(relativeTime);

const { RangePicker } = DatePicker;
const { Option } = Select;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

const AssetMovement = () => {
  const screens = useBreakpoint();
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [movements, setMovements] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [filters, setFilters] = useState({
    assetTag: '',
    movementType: undefined,
    status: undefined,
    dateRange: null
  });
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [assetHistory, setAssetHistory] = useState([]);
  const { showSuccess, showError } = useNotification();

  // Debounced fetch for filters
  useEffect(() => {
    // Reset to page 1 when filters change
    if (pagination.current !== 1) {
      setPagination(prev => ({ ...prev, current: 1 }));
      return; // Don't fetch yet, let the pagination change trigger it
    }

    // Debounce filter changes (500ms delay)
    const timeoutId = setTimeout(() => {
      fetchMovements();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [filters]);

  // Fetch when pagination changes
  useEffect(() => {
    fetchMovements();
  }, [pagination.current, pagination.pageSize]);

  // Fetch statistics on mount
  useEffect(() => {
    fetchStatistics();
  }, []);

  const fetchMovements = async () => {
    setLoading(true);
    try {
      // Build query params object
      const params = {
        limit: pagination.pageSize,
        offset: (pagination.current - 1) * pagination.pageSize
      };

      // Add filters if they exist
      if (filters.assetTag && filters.assetTag.trim()) {
        params.assetTag = filters.assetTag.trim();
      }

      if (filters.movementType) {
        params.movementType = filters.movementType;
      }

      if (filters.status) {
        params.status = filters.status;
      }

      if (filters.dateRange && filters.dateRange.length === 2) {
        params.startDate = filters.dateRange[0].format('YYYY-MM-DD');
        params.endDate = filters.dateRange[1].format('YYYY-MM-DD');
      }

      const response = await apiClient.get('/asset-movements/recent', { params });

      if (response.data.success) {
        const movements = response.data.data || [];
        const total = response.data.pagination?.total || 0;
        console.log('Asset movements received:', movements.length, 'Total:', total);
        setMovements(movements);
        setPagination(prev => ({
          ...prev,
          total: total
        }));
      }
    } catch (error) {
      showError('Failed to fetch asset movements');
      console.error('Error fetching movements:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStatistics = async () => {
    try {
      const response = await apiClient.get('/asset-movements/statistics');
      if (response.data.success) {
        console.log('Movement statistics received:', response.data.data);
        setStatistics(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching statistics:', error);
      showError('Failed to fetch movement statistics');
    }
  };

  const fetchAssetHistory = async (assetId) => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/asset-movements/asset/${assetId}`);
      if (response.data.success) {
        setAssetHistory(response.data.data);
        setTimelineVisible(true);
      }
    } catch (error) {
      showError('Failed to fetch asset history');
      console.error('Error fetching asset history:', error);
    } finally {
      setLoading(false);
    }
  };

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.assetTag && filters.assetTag.trim()) count++;
    if (filters.movementType) count++;
    if (filters.status) count++;
    if (filters.dateRange) count++;
    return count;
  }, [filters]);

  // Reset all filters
  const handleResetFilters = () => {
    setFilters({
      assetTag: '',
      movementType: undefined,
      status: undefined,
      dateRange: null
    });
  };

  const handleViewHistory = (record) => {
    setSelectedAsset(record);
    fetchAssetHistory(record.asset_id);
  };

  const handleExportToExcel = async () => {
    setExportLoading(true);
    try {
      // Build query params (same as filters)
      const params = {};

      if (filters.assetTag && filters.assetTag.trim()) {
        params.assetTag = filters.assetTag.trim();
      }

      if (filters.movementType) {
        params.movementType = filters.movementType;
      }

      if (filters.status) {
        params.status = filters.status;
      }

      if (filters.dateRange && filters.dateRange.length === 2) {
        params.startDate = filters.dateRange[0].format('YYYY-MM-DD');
        params.endDate = filters.dateRange[1].format('YYYY-MM-DD');
      }

      const response = await apiClient.get('/asset-movements/export/excel', {
        params,
        responseType: 'blob' // Important for file download
      });

      // Create blob from response
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Generate filename with current date
      const timestamp = new Date().toISOString().split('T')[0];
      link.setAttribute('download', `Asset_Movements_${timestamp}.xlsx`);

      // Trigger download
      document.body.appendChild(link);
      link.click();

      // Cleanup
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      showSuccess('Excel file downloaded successfully');
    } catch (error) {
      showError('Failed to export to Excel');
      console.error('Error exporting to Excel:', error);
    } finally {
      setExportLoading(false);
    }
  };

  const getMovementTypeColor = (type) => {
    const colors = {
      assigned: 'blue',
      transferred: 'orange',
      returned: 'green',
      relocated: 'purple',
      unassigned: 'red',
      available: 'default',
      component_install: 'cyan',
      component_remove: 'magenta'
    };
    return colors[type] || 'default';
  };

  const getStatusColor = (status) => {
    const colors = {
      assigned: 'success',
      available: 'default',
      maintenance: 'warning',
      retired: 'error',
      lost: 'error',
      damaged: 'warning'
    };
    return colors[status] || 'default';
  };

  const columns = [
    {
      title: 'Date & Time',
      dataIndex: 'movement_date',
      key: 'movement_date',
      width: 180,
      render: (date) => (
        <Space direction="vertical" size={0}>
          <Text strong>{dayjs(date).format('DD MMM YYYY')}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {dayjs(date).format('HH:mm:ss')}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {dayjs(date).fromNow()}
          </Text>
        </Space>
      ),
      sorter: (a, b) => dayjs(a.movement_date).unix() - dayjs(b.movement_date).unix(),
      defaultSortOrder: 'descend'
    },
    {
      title: 'Sr.No',
      dataIndex: 'serial_number',
      key: 'serial_number',
      width: 150,
      ellipsis: { showTitle: false },
      render: (text) => (
        <Tooltip title={text || 'N/A'}>
          <Text strong>{text || '-'}</Text>
        </Tooltip>
      )
    },
    {
      title: 'Sub Category',
      dataIndex: 'subcategory_name',
      key: 'subcategory_name',
      width: 180,
      ellipsis: {
        showTitle: false,
      },
      render: (text) => (
        <Tooltip title={text || 'N/A'}>
          <Text>{text || '-'}</Text>
        </Tooltip>
      )
    },
    {
      title: 'Movement Type',
      dataIndex: 'movement_type',
      key: 'movement_type',
      width: 180,
      ellipsis: {
        showTitle: false,
      },
      render: (type) => {
        const displayText = type?.replace(/_/g, ' ').toUpperCase();
        return (
          <Tooltip title={displayText}>
            <Tag color={getMovementTypeColor(type)} icon={<SwapOutlined />} style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayText}
            </Tag>
          </Tooltip>
        );
      }
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status) => (
        <Tag color={getStatusColor(status)}>{status?.toUpperCase()}</Tag>
      )
    },
    {
      title: 'From',
      key: 'from',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.previous_user_name && (
            <Text type="secondary">
              <UserOutlined /> {record.previous_user_name}
            </Text>
          )}
          {record.previous_location_name && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              <EnvironmentOutlined /> {record.previous_location_name}
            </Text>
          )}
          {!record.previous_user_name && !record.previous_location_name && (
            <Text type="secondary">—</Text>
          )}
        </Space>
      )
    },
    {
      title: 'To',
      key: 'to',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {record.assigned_to_name && (
            <Text strong>
              <UserOutlined /> {record.assigned_to_name}
            </Text>
          )}
          {record.location_name && (
            <Text style={{ fontSize: 12 }}>
              <EnvironmentOutlined /> {record.location_name}
            </Text>
          )}
          {!record.assigned_to_name && !record.location_name && (
            <Text type="secondary">Unassigned</Text>
          )}
        </Space>
      )
    },
    {
      title: 'Reason',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
      render: (text) => (
        <Tooltip title={text}>
          <Text type="secondary">{text || '—'}</Text>
        </Tooltip>
      )
    },
    {
      title: 'Performed By',
      dataIndex: 'performed_by_name',
      key: 'performed_by_name',
      width: 150,
      render: (name) => (
        <Text>
          <UserOutlined /> {name}
        </Text>
      )
    }
  ];

  const handleTableChange = (newPagination) => {
    setPagination({
      ...pagination,
      current: newPagination.current,
      pageSize: newPagination.pageSize
    });
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <Title level={2}>
          <SwapOutlined /> Asset Movement Tracking
        </Title>
        <Text type="secondary">
          Track and monitor all asset assignments, transfers, and location changes
        </Text>
      </div>

      {/* Statistics Cards */}
      {statistics && (
        <Row gutter={[16, 16]} className="mb-6">
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic
                title="Total Movements"
                value={statistics.total_movements}
                prefix={<SwapOutlined />}
                valueStyle={{ color: '#1890ff' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic
                title="Assignments"
                value={statistics.assignments}
                prefix={<UserOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic
                title="Transfers"
                value={statistics.transfers}
                prefix={<SwapOutlined />}
                valueStyle={{ color: '#fa8c16' }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic
                title="Returns"
                value={statistics.returns}
                prefix={<HistoryOutlined />}
                valueStyle={{ color: '#722ed1' }}
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Filters */}
      <Card
        className="mb-4"
        style={{ borderColor: activeFilterCount > 0 ? '#1890ff' : undefined }}
      >
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <Space>
                <FilterOutlined />
                <Text strong>Filters</Text>
                {activeFilterCount > 0 && (
                  <Badge count={activeFilterCount} style={{ backgroundColor: '#1890ff' }} />
                )}
              </Space>
              <Space size="small">
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={handleExportToExcel}
                  loading={exportLoading}
                  size={screens.xs ? 'small' : 'middle'}
                >
                  {screens.xs ? '' : 'Export to Excel'}
                </Button>
                {activeFilterCount > 0 && (
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={handleResetFilters}
                  >
                    {screens.xs ? '' : 'Reset Filters'}
                  </Button>
                )}
              </Space>
            </div>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Input
              placeholder={screens.xs ? 'Sr.No' : 'Search by serial number'}
              prefix={<SearchOutlined />}
              value={filters.assetTag}
              onChange={(e) => setFilters({ ...filters, assetTag: e.target.value })}
              allowClear
            />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Select
              placeholder={screens.xs ? 'Type' : 'Filter by movement type'}
              style={{ width: '100%' }}
              value={filters.movementType}
              onChange={(value) => setFilters({ ...filters, movementType: value })}
              allowClear
            >
              <Option value="assigned">Assigned</Option>
              <Option value="transferred">Transferred</Option>
              <Option value="returned">Returned</Option>
              <Option value="relocated">Relocated</Option>
              <Option value="unassigned">Unassigned</Option>
              <Option value="component_install">Component Install</Option>
              <Option value="component_remove">Component Remove</Option>
            </Select>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Select
              placeholder={screens.xs ? 'Status' : 'Filter by status'}
              style={{ width: '100%' }}
              value={filters.status}
              onChange={(value) => setFilters({ ...filters, status: value })}
              allowClear
            >
              <Option value="available">Available</Option>
              <Option value="assigned">Assigned</Option>
              <Option value="in-use">In-use</Option>
              <Option value="maintenance">Maintenance</Option>
            </Select>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <RangePicker
              style={{ width: '100%' }}
              value={filters.dateRange}
              onChange={(dates) => setFilters({ ...filters, dateRange: dates })}
              placeholder={screens.xs ? ['From', 'To'] : ['Start Date', 'End Date']}
            />
          </Col>
        </Row>
      </Card>

      {/* Movements Table */}
      <Card>
        <Table
          columns={columns}
          dataSource={movements}
          rowKey="id"
          loading={loading}
          pagination={{
            ...pagination,
            simple: screens.xs,
            showSizeChanger: !screens.xs,
            showTotal: (total, range) =>
              screens.xs
                ? `${range[0]}-${range[1]}/${total}`
                : `${range[0]}-${range[1]} of ${total} items`,
            pageSizeOptions: ['10', '20', '50', '100']
          }}
          onChange={handleTableChange}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: activeFilterCount > 0 ? (
              <Empty
                description={
                  <Space direction="vertical" size="small">
                    <Text>No movements match your filters</Text>
                    <Button size="small" onClick={handleResetFilters}>
                      Clear Filters
                    </Button>
                  </Space>
                }
              />
            ) : (
              <Empty description="No movement records found" />
            )
          }}
        />
      </Card>

      {/* Asset History Timeline Modal */}
      <Modal
        title={
          <Space>
            <HistoryOutlined />
            <span>Asset Movement History</span>
            {selectedAsset && <Tag color="blue">{selectedAsset.asset_tag}</Tag>}
          </Space>
        }
        open={timelineVisible}
        onCancel={() => setTimelineVisible(false)}
        footer={[
          <Button key="close" onClick={() => setTimelineVisible(false)}>
            Close
          </Button>
        ]}
        width={screens.xs ? '100%' : screens.sm ? '90%' : 800}
        style={{ maxWidth: screens.xs ? 'none' : 800 }}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Spin spinning={loading}>
          {assetHistory.length > 0 ? (
            <Timeline
              mode={screens.md ? 'left' : 'alternate'}
              style={{ marginTop: 20 }}
            >
              {assetHistory.map((movement) => (
                <Timeline.Item
                  key={movement.id}
                  color={getMovementTypeColor(movement.movement_type)}
                  label={screens.md ? (
                    <Space direction="vertical" size={0}>
                      <Text strong>{dayjs(movement.movement_date).format('DD MMM YYYY')}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(movement.movement_date).format('HH:mm')}
                      </Text>
                    </Space>
                  ) : undefined}
                >
                  <Card size="small" style={{ marginBottom: 8 }}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      {!screens.md && (
                        <Text strong style={{ fontSize: 12 }}>
                          {dayjs(movement.movement_date).format('DD MMM YYYY HH:mm')}
                        </Text>
                      )}
                      <Space wrap>
                        <Tag color={getMovementTypeColor(movement.movement_type)}>
                          {movement.movement_type?.replace(/_/g, ' ').toUpperCase()}
                        </Tag>
                        <Tag color={getStatusColor(movement.status)}>
                          {movement.status?.toUpperCase()}
                        </Tag>
                      </Space>

                      {movement.assigned_to_name && (
                        <Text style={{ fontSize: screens.xs ? 12 : 14 }}>
                          <UserOutlined /> <strong>Assigned to:</strong> {movement.assigned_to_name}
                        </Text>
                      )}

                      {movement.location_name && (
                        <Text style={{ fontSize: screens.xs ? 12 : 14 }}>
                          <EnvironmentOutlined /> <strong>Location:</strong> {movement.location_name}
                        </Text>
                      )}

                      {movement.previous_user_name && (
                        <Text type="secondary" style={{ fontSize: screens.xs ? 12 : 14 }}>
                          <strong>From:</strong> {movement.previous_user_name}
                        </Text>
                      )}

                      {movement.reason && (
                        <Text type="secondary" style={{ fontSize: screens.xs ? 12 : 14 }}>
                          <strong>Reason:</strong> {movement.reason}
                        </Text>
                      )}

                      <Text type="secondary" style={{ fontSize: 11 }}>
                        <ClockCircleOutlined /> {movement.performed_by_name}
                      </Text>
                    </Space>
                  </Card>
                </Timeline.Item>
              ))}
            </Timeline>
          ) : (
            <Empty description="No movement history found" />
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default AssetMovement;
