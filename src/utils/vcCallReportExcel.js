import * as XLSX from 'xlsx';

const formatDate = (value) => {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const getDateRange = (reports) => {
  if (!reports || reports.length === 0) {
    return '';
  }

  const dates = reports
    .map((item) => item.created_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!dates.length) {
    return '';
  }

  dates.sort((a, b) => a - b);

  return `${formatDate(dates[0])} - ${formatDate(
    dates[dates.length - 1]
  )}`;
};

export const exportVCCallReport = (reports) => {
  if (!reports || reports.length === 0) {
    return false;
  }

  const dateRange = getDateRange(reports);

  const title = dateRange
    ? `VC Call Report (${dateRange})`
    : 'VC Call Report';

  /*
   * Severity level has intentionally been removed.
   *
   * User Name, Department, Location and Category
   * are retained.
   */
  const headers = [
    'Sr. No',
    'Cust. Name',
    'Date',
    'User Name',
    'Department',
    'Location',
    'Category',
    'Problem',
    'Engineer Name',
    'Action Taken',
    'Spare used',
    'Time Resolution',
    'Date',
    'Status',
  ];

  const rows = reports.map((item, index) => [
    index + 1,

    'PMC',

    formatDate(item.created_at),

    item.created_by_user_name ||
      item.created_by_name ||
      '-',

    item.department_name ||
      item.department ||
      '-',

    item.location_name ||
      item.location ||
      '-',

    item.category || 'VC Reports',

    item.title || '-',

    item.assigned_engineer_name ||
      item.engineer_name ||
      '-',

    item.resolution_notes ||
      item.action_taken ||
      item.description ||
      '-',

    item.spares_used ||
      item.spare_used ||
      'NA',

    item.time_resolution ||
      '-',

    formatDate(
      item.closed_at ||
      item.resolved_at ||
      item.created_at
    ),

    item.status
      ? item.status
          .replaceAll('_', ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase())
      : '-',
  ]);

  const worksheetData = [
    [
      'IT Department Municipal Corporation Pune',
    ],

    [
      'Main Building PMC, Congress House Road, Near PMC Metro Station, Shivaji Nagar, Pune, Maharashtra - 411005',
    ],

    [
      'Vendor Name :- Polestar Consulting Pvt Ltd',
    ],

    [
      'Tender No :- PMC/IT/2022/13 – Facility Management Services (FMS)',
    ],

    [title],

    headers,

    ...rows,
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(
    worksheetData
  );

  const totalColumns = headers.length;

  worksheet['!merges'] = [
    {
      s: { r: 0, c: 0 },
      e: {
        r: 0,
        c: totalColumns - 1,
      },
    },

    {
      s: { r: 1, c: 0 },
      e: {
        r: 1,
        c: totalColumns - 1,
      },
    },

    {
      s: { r: 2, c: 0 },
      e: {
        r: 2,
        c: totalColumns - 1,
      },
    },

    {
      s: { r: 3, c: 0 },
      e: {
        r: 3,
        c: totalColumns - 1,
      },
    },

    {
      s: { r: 4, c: 0 },
      e: {
        r: 4,
        c: totalColumns - 1,
      },
    },
  ];

  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 22 },
    { wch: 22 },
    { wch: 18 },
    { wch: 22 },
    { wch: 35 },
    { wch: 24 },
    { wch: 45 },
    { wch: 15 },
    { wch: 18 },
    { wch: 15 },
    { wch: 14 },
  ];

  worksheet['!rows'] = [
    { hpt: 28 },
    { hpt: 45 },
    { hpt: 25 },
    { hpt: 25 },
    { hpt: 25 },
    { hpt: 40 },
  ];

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    'VC Call Report'
  );

  XLSX.writeFile(
    workbook,
    `VC_Call_Report_${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`
  );

  return true;
};
