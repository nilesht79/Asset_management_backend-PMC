const ExcelJS = require('exceljs');

/**
 * Generate bulk user upload Excel template
 * @param {Array} departments - List of departments with names
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateUserUploadTemplate(departments = []) {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('Users', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns (* = required field)
  worksheet.columns = [
    { header: 'First Name*', key: 'first_name', width: 15 },
    { header: 'Last Name*', key: 'last_name', width: 15 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Password', key: 'password', width: 15 },
    { header: 'Role*', key: 'role', width: 20 },
    { header: 'Employee ID', key: 'employee_id', width: 15 },
    { header: 'Designation', key: 'designation', width: 25 },
    { header: 'Department Name', key: 'department_name', width: 25 },
    { header: 'Location Name', key: 'location_name', width: 25 },
    { header: 'Is Active', key: 'is_active', width: 12 },
    { header: 'Is VIP', key: 'is_vip', width: 12 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add sample data rows
  worksheet.addRow({
    first_name: 'John',
    last_name: 'Doe',
    email: 'john.doe@company.com',
    password: 'Test@123',
    role: 'employee',
    employee_id: 'EMP-12345678',
    designation: 'Software Engineer',
    department_name: departments.length > 0 ? departments[0].department_name : 'I.T Department',
    location_name: '', // Optional: Must match existing location name
    is_active: 'true',
    is_vip: 'false'
  });

  worksheet.addRow({
    first_name: 'Jane',
    last_name: 'Smith',
    email: '', // Will auto-generate as jane.smith@company.local
    password: '', // Will auto-generate secure password
    role: 'engineer',
    employee_id: '', // Will auto-generate
    designation: 'Senior Developer',
    department_name: 'Finance', // Will auto-create if doesn't exist
    location_name: '', // Optional: Must match existing location name
    is_active: 'true',
    is_vip: 'true'
  });

  // Add data validations for Role column (column E)
  worksheet.getColumn(5).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) { // Skip header
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"superadmin,admin,department_head,coordinator,engineer,employee"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Role',
        error: 'Please select a valid role from the list'
      };
    }
  });

  // Add data validations for Is Active column (column J - after adding Designation)
  worksheet.getColumn(10).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Add data validations for Is VIP column (column K)
  worksheet.getColumn(11).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 60 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'First Name', required: 'Yes', description: 'Employee first name (2-50 characters)' },
    { field: 'Last Name', required: 'Yes', description: 'Employee last name (2-50 characters)' },
    { field: 'Email', required: 'No', description: 'Valid email address (auto-generated as firstname.lastname@company.local if left blank)' },
    { field: 'Password', required: 'No', description: 'Minimum 8 characters with uppercase, lowercase, number, and special character (auto-generated if left blank)' },
    { field: 'Role', required: 'Yes', description: 'User role: superadmin, admin, department_head, coordinator, engineer, or employee' },
    { field: 'Employee ID', required: 'No', description: 'Employee ID (auto-generated as T-10000, T-10001, etc. if left blank)' },
    { field: 'Designation', required: 'No', description: 'Job title or designation (e.g., Software Engineer, Manager, etc.)' },
    { field: 'Department Name', required: 'No', description: 'Department name (auto-created if doesn\'t exist, leave blank for no department)' },
    { field: 'Location Name', required: 'No', description: 'Location name (must match existing location in system, leave blank for no location)' },
    { field: 'Is Active', required: 'No', description: 'User active status: true or false (default: true)' },
    { field: 'Is VIP', required: 'No', description: 'VIP status: true or false (default: false)' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add available departments section
  if (departments.length > 0) {
    instructionsSheet.addRow({});
    instructionsSheet.addRow({ field: 'AVAILABLE DEPARTMENTS:', required: '', description: '' });
    const deptHeaderRow = instructionsSheet.lastRow;
    deptHeaderRow.font = { bold: true };
    deptHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' }
    };

    departments.forEach(dept => {
      instructionsSheet.addRow({ field: dept.department_name, required: '', description: dept.description || '' });
    });
  }

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'NOTES:', required: '', description: '' });
  const notesRow = instructionsSheet.lastRow;
  notesRow.font = { bold: true };

  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Fields marked with * are required'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Email addresses must be unique'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Department names are case-sensitive and must match exactly'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Invalid rows will be reported with specific error messages'
  });
  instructionsSheet.addRow({
    field: '',
    required: '',
    description: '• Sample data is provided in the Users sheet - replace it with your actual data'
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate bulk asset upload Excel template
 * @param {Object} params - Template parameters
 * @param {number} params.quantity - Number of asset rows to generate
 * @param {Object} params.product - Product details
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateAssetBulkTemplate({ quantity, product }) {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('Assets', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Product Name', key: 'product_name', width: 25 },
    { header: 'Product Model', key: 'product_model', width: 20 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'OEM', key: 'oem', width: 15 },
    { header: 'Asset Type', key: 'asset_type', width: 15 },
    { header: 'Parent Serial Number', key: 'parent_serial_number', width: 25 },
    { header: 'Is Standby Asset', key: 'is_standby_asset', width: 18 },
    { header: 'Standby Available', key: 'standby_available', width: 18 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Condition', key: 'condition_status', width: 15 },
    { header: 'Importance', key: 'importance', width: 15 },
    { header: 'Vendor', key: 'vendor_name', width: 20 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Purchase Date', key: 'purchase_date', width: 18 },
    { header: 'Purchase Cost', key: 'purchase_cost', width: 18 },
    { header: 'Warranty Start', key: 'warranty_start_date', width: 18 },
    { header: 'Warranty End', key: 'warranty_end_date', width: 18 },
    { header: 'Expected EOL', key: 'eol_date', width: 18 },
    { header: 'Expected EOS', key: 'eos_date', width: 18 },
    { header: 'Installation Notes', key: 'installation_notes', width: 35 },
    { header: 'Notes', key: 'notes', width: 35 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add data rows with sample data showing component hierarchy
  if (quantity > 0) {
    worksheet.addRow({
      row_number: 1,
      serial_number: '', // User fills this
      product_name: product?.name || '',
      product_model: product?.model || '',
      category: product?.category_name || '',
      oem: product?.oem_name || '',
      asset_type: 'standalone',
      parent_serial_number: '',
      is_standby_asset: 'false',
      standby_available: '',
      status: 'available',
      condition_status: 'new',
      importance: 'medium',
      vendor_name: 'PoleStar',
      invoice_number: '',
      purchase_date: '',
      purchase_cost: '',
      warranty_start_date: '',
      warranty_end_date: '',
      eol_date: '',
      eos_date: '',
      installation_notes: '',
      notes: ''
    });
  }

  for (let i = 2; i <= quantity; i++) {
    worksheet.addRow({
      row_number: i,
      serial_number: '', // User fills this
      product_name: product?.name || '',
      product_model: product?.model || '',
      category: product?.category_name || '',
      oem: product?.oem_name || '',
      asset_type: 'standalone',
      parent_serial_number: '',
      is_standby_asset: 'false',
      standby_available: '',
      status: 'available',
      condition_status: 'new',
      importance: 'medium',
      vendor_name: 'PoleStar',
      invoice_number: '',
      purchase_date: '',
      purchase_cost: '',
      warranty_start_date: '',
      warranty_end_date: '',
      eol_date: '',
      eos_date: '',
      installation_notes: '',
      notes: ''
    });
  }

  // Add data validation for Asset Type column (column 7)
  worksheet.getColumn(7).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"standalone,component"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Asset Type',
        error: 'Please select standalone or component. Leave empty for standalone (default).'
      };
    }
  });

  // Add data validation for Is Standby Asset column (column 9)
  worksheet.getColumn(9).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false. Leave empty for false (default). Standby assets cannot be assigned to users.'
      };
    }
  });

  // Add data validation for Standby Available column (column 10)
  worksheet.getColumn(10).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false. Only applicable for standby assets.'
      };
    }
  });

  // Add data validation for Status column (column 11)
  worksheet.getColumn(11).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"available,assigned,in_use,under_repair,disposed"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Status',
        error: 'Please select a valid status from the list'
      };
    }
  });

  // Add data validation for Condition column (column 12)
  worksheet.getColumn(12).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"new,excellent,good,fair,poor"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Condition',
        error: 'Please select a valid condition from the list'
      };
    }
  });

  // Add data validation for Importance column (column 13)
  worksheet.getColumn(13).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"critical,high,medium,low"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Importance',
        error: 'Please select a valid importance level: critical, high, medium, or low'
      };
    }
  });

  // Add data validation for OS License Type column (column 22 - shifted by 1)
  worksheet.getColumn(22).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"oem,retail,volume,subscription"'],
        showErrorMessage: true,
        errorTitle: 'Invalid License Type',
        error: 'Please select a valid license type from the list'
      };
    }
  });

  // Add data validation for Office License Type column (column 25 - shifted by 1)
  worksheet.getColumn(25).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"oem,retail,volume,subscription"'],
        showErrorMessage: true,
        errorTitle: 'Invalid License Type',
        error: 'Please select a valid license type from the list'
      };
    }
  });

  // Create Additional Software sheet
  const softwareSheet = workbook.addWorksheet('Additional Software');
  softwareSheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Software Type*', key: 'software_type', width: 18 },
    { header: 'Software Name*', key: 'software_name', width: 30 },
    { header: 'License Key', key: 'license_key', width: 35 },
    { header: 'License Type', key: 'license_type', width: 18 },
    { header: 'Activation Date', key: 'activation_date', width: 18 },
    { header: 'Expiration Date', key: 'expiration_date', width: 18 },
    { header: 'Notes', key: 'notes', width: 35 }
  ];

  // Style header row for software sheet
  const softwareHeaderRow = softwareSheet.getRow(1);
  softwareHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  softwareHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  softwareHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  softwareHeaderRow.height = 25;

  // Add sample rows for additional software
  softwareSheet.addRow({
    row_number: 1,
    serial_number: '', // Match to asset serial number
    software_type: 'application',
    software_name: 'Adobe Acrobat Pro',
    license_key: '',
    license_type: 'retail',
    activation_date: '',
    expiration_date: '',
    notes: ''
  });

  softwareSheet.addRow({
    row_number: 2,
    serial_number: '', // Match to asset serial number
    software_type: 'application',
    software_name: 'AutoCAD 2024',
    license_key: '',
    license_type: 'subscription',
    activation_date: '',
    expiration_date: '2025-12-31',
    notes: ''
  });

  // Add data validation for Software Type column
  softwareSheet.getColumn(3).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"operating_system,application,utility,driver"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Software Type',
        error: 'Please select a valid software type from the list'
      };
    }
  });

  // Add data validation for License Type column
  softwareSheet.getColumn(6).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"oem,retail,volume,subscription"'],
        showErrorMessage: true,
        errorTitle: 'Invalid License Type',
        error: 'Please select a valid license type from the list'
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Description', key: 'description', width: 80 }
  ];

  // Style header
  const instrHeader = instructionsSheet.getRow(1);
  instrHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };

  // Add instructions
  instructionsSheet.addRow({ field: 'Serial Number*', description: 'REQUIRED. Unique serial number for each asset.' });
  instructionsSheet.addRow({ field: 'Asset Type', description: 'standalone (default) or component. Components are parts like RAM, HDD. Can be spare stock without parent.' });
  instructionsSheet.addRow({ field: 'Parent Serial Number', description: 'Only for components. Leave empty for spare stock components. Provide serial number when installing.' });
  instructionsSheet.addRow({ field: 'Is Standby Asset', description: 'true/false (default: false). Standby assets go in separate pool, not regular inventory.' });
  instructionsSheet.addRow({ field: 'Standby Available', description: 'true/false. Only for standby assets. Tracks if asset is available for assignment.' });
  instructionsSheet.addRow({ field: 'Status', description: 'available, assigned, in_use, under_repair, disposed (default: available)' });
  instructionsSheet.addRow({ field: 'Condition', description: 'new, excellent, good, fair, poor (default: new)' });

  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'IMPORTANT RULES:', description: '' });
  const rulesRow = instructionsSheet.lastRow;
  rulesRow.font = { bold: true };
  rulesRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };

  instructionsSheet.addRow({ field: '', description: '• Components CANNOT be assigned to users (they install into parent assets)' });
  instructionsSheet.addRow({ field: '', description: '• Standby assets CANNOT be assigned to users (managed via standby pool)' });
  instructionsSheet.addRow({ field: '', description: '• Spare components: Leave parent empty, set status to "available"' });
  instructionsSheet.addRow({ field: '', description: '• Installed components: Provide parent serial number, status "in_use"' });
  instructionsSheet.addRow({ field: '', description: '• Standby assets appear in separate Standby Pool page, not regular inventory' });
  instructionsSheet.addRow({ field: '', description: '• All assets of same product will be imported together' });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Parse uploaded asset Excel file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @param {string} productId - Product ID for all assets
 * @returns {Promise<Array>} Parsed asset data
 */
async function parseAssetBulkFile(fileBuffer, productId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Assets');
  if (!worksheet) {
    throw new Error('Assets worksheet not found in file');
  }

  const assets = [];
  const errors = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return;

    const assetType = row.getCell(7).value?.toString().trim().toLowerCase() || 'standalone';
    const parentAssetTag = row.getCell(8).value?.toString().trim() || null;
    const isStandbyAsset = row.getCell(9).value?.toString().trim().toLowerCase() === 'true';
    const standbyAvailable = row.getCell(10).value?.toString().trim().toLowerCase() === 'true';

    const rowData = {
      row_number: row.getCell(1).value,
      serial_number: row.getCell(2).value?.toString().trim() || '',
      asset_type: assetType,
      parent_serial_number: parentAssetTag,
      is_standby_asset: isStandbyAsset,
      standby_available: standbyAvailable,
      status: row.getCell(11).value?.toString().trim() || 'available',
      condition_status: row.getCell(12).value?.toString().trim() || 'new',
      importance: row.getCell(13).value?.toString().trim() || 'medium',
      vendor_name: row.getCell(14).value?.toString().trim() || null,
      invoice_number: row.getCell(15).value?.toString().trim() || null,
      purchase_date: row.getCell(16).value || null,
      purchase_cost: row.getCell(17).value || null,
      warranty_start_date: row.getCell(18).value || null,
      warranty_end_date: row.getCell(19).value || null,
      eol_date: row.getCell(20).value || null,
      eos_date: row.getCell(21).value || null,
      installation_notes: row.getCell(22).value?.toString().trim() || null,
      notes: row.getCell(23).value?.toString().trim() || null,
      product_id: productId,
      additional_software: [] // Will be populated from Additional Software sheet
    };

    // Validate serial number
    if (!rowData.serial_number) {
      errors.push(`Row ${rowNumber}: Serial number is required`);
      return;
    }

    // Validate asset type
    if (!['standalone', 'component'].includes(rowData.asset_type)) {
      errors.push(`Row ${rowNumber}: Invalid asset_type '${rowData.asset_type}'. Must be 'standalone' or 'component'`);
      return;
    }

    // Validate component: parent_serial_number is optional (can be spare stock)
    // No validation needed - components can exist without parent

    // Validate standalone should not have parent_serial_number
    if (rowData.asset_type === 'standalone' && rowData.parent_serial_number) {
      errors.push(`Row ${rowNumber}: Standalone assets cannot have a Parent Serial Number. Set asset_type to 'component' or remove parent_serial_number`);
      return;
    }

    // Validate standby asset rules
    if (rowData.is_standby_asset) {
      // Standby assets should have standby_available set
      if (rowData.standby_available === undefined || rowData.standby_available === null) {
        // Default to true if not specified
        rowData.standby_available = true;
      }
    }

    assets.push(rowData);
  });

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  // Check for duplicates within the file
  const serialNumbers = assets.map(a => a.serial_number);
  const duplicates = serialNumbers.filter((item, index) => serialNumbers.indexOf(item) !== index);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate serial numbers found: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Parse Additional Software sheet if it exists
  const softwareSheet = workbook.getWorksheet('Additional Software');
  if (softwareSheet) {
    const additionalSoftware = [];

    softwareSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // Skip header row
      if (rowNumber === 1) return;

      const serialNumber = row.getCell(2).value?.toString().trim();
      const softwareType = row.getCell(3).value?.toString().trim();
      const softwareName = row.getCell(4).value?.toString().trim();

      // Skip empty rows
      if (!serialNumber || !softwareName) return;

      const softwareData = {
        row_number: row.getCell(1).value,
        serial_number: serialNumber,
        software_type: softwareType || 'application',
        software_name: softwareName,
        license_key: row.getCell(5).value?.toString().trim() || null,
        license_type: row.getCell(6).value?.toString().trim() || 'retail',
        activation_date: row.getCell(7).value || null,
        expiration_date: row.getCell(8).value || null,
        notes: row.getCell(9).value?.toString().trim() || null
      };

      additionalSoftware.push(softwareData);
    });

    // Map additional software to assets by serial number
    additionalSoftware.forEach(software => {
      const asset = assets.find(a => a.serial_number === software.serial_number);
      if (asset) {
        asset.additional_software.push(software);
      } else {
        console.warn(`Warning: Additional software for serial number '${software.serial_number}' not found in Assets sheet`);
      }
    });
  }

  return assets;
}

/**
 * Generate legacy asset upload Excel template with reference sheets
 * @param {Object} params - Template parameters
 * @param {Array} params.products - List of products with details
 * @param {Array} params.users - List of users for assignment
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateLegacyAssetTemplate({ products, users, vendors = [] }) {
  const workbook = new ExcelJS.Workbook();

  // Create main Assets sheet
  const worksheet = workbook.addWorksheet('Assets', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns for main sheet
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Product Name/ID*', key: 'product', width: 30 },
    { header: 'Asset Type', key: 'asset_type', width: 15 },
    { header: 'Parent Serial Number', key: 'parent_serial_number', width: 25 },
    { header: 'Is Standby Asset', key: 'is_standby_asset', width: 18 },
    { header: 'Standby Available', key: 'standby_available', width: 18 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Condition', key: 'condition_status', width: 15 },
    { header: 'Importance', key: 'importance', width: 15 },
    { header: 'Vendor', key: 'vendor_name', width: 20 },
    { header: 'Invoice Number', key: 'invoice_number', width: 20 },
    { header: 'Purchase Date', key: 'purchase_date', width: 18 },
    { header: 'Purchase Cost', key: 'purchase_cost', width: 18 },
    { header: 'Warranty Start', key: 'warranty_start_date', width: 18 },
    { header: 'Warranty End', key: 'warranty_end_date', width: 18 },
    { header: 'Expected EOL', key: 'eol_date', width: 18 },
    { header: 'Expected EOS', key: 'eos_date', width: 18 },
    { header: 'Assigned To (Email/Employee ID)', key: 'assigned_to', width: 35 },
    { header: 'Installation Notes', key: 'installation_notes', width: 35 },
    { header: 'Notes', key: 'notes', width: 40 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Get first vendor name for samples (or use default)
  const sampleVendor = vendors.length > 0 ? vendors[0].name : 'PoleStar Consulting';

  // Add sample rows showing component hierarchy
  worksheet.addRow({
    row_number: 1,
    serial_number: 'SN-2023-001',
    product: 'Dell Laptop E7450',
    asset_type: 'standalone',
    parent_serial_number: '',
    is_standby_asset: 'false',
    standby_available: '',
    status: 'available',
    condition_status: 'good',
    importance: 'medium',
    vendor_name: sampleVendor,
    invoice_number: 'INV-2023-001',
    purchase_date: '2023-01-15',
    purchase_cost: 45000,
    warranty_start_date: '2023-01-15',
    warranty_end_date: '2026-01-15',
    eol_date: '2028-01-15',
    eos_date: '2027-01-15',
    assigned_to: '',
    installation_notes: '',
    notes: 'Legacy asset. Asset tag and tag number will be auto-generated.'
  });

  worksheet.addRow({
    row_number: 2,
    serial_number: 'SN-2023-002',
    product: products.length > 0 ? products[0].id : '',
    asset_type: 'standalone',
    parent_serial_number: '',
    is_standby_asset: 'false',
    standby_available: '',
    status: 'assigned',
    condition_status: 'excellent',
    importance: 'high',
    vendor_name: sampleVendor,
    invoice_number: 'INV-2023-002',
    purchase_date: '2023-03-20',
    purchase_cost: 52000,
    warranty_start_date: '2023-03-20',
    warranty_end_date: '2026-03-20',
    eol_date: '',
    eos_date: '',
    assigned_to: users.length > 0 ? users[0].email : '',
    installation_notes: '',
    notes: 'Asset inherits location from assigned user'
  });

  worksheet.addRow({
    row_number: 3,
    serial_number: 'RAM-SN-003',
    product: 'Kingston 16GB DDR4',
    asset_type: 'component',
    parent_serial_number: 'SN-2023-001',
    is_standby_asset: 'false',
    standby_available: '',
    status: 'in_use',
    condition_status: 'new',
    importance: 'low',
    vendor_name: sampleVendor,
    invoice_number: '',
    purchase_date: '2023-03-20',
    purchase_cost: 5000,
    warranty_start_date: '2023-03-20',
    warranty_end_date: '2026-03-20',
    assigned_to: '',
    installation_notes: 'Installed in desktop during initial build',
    notes: 'Component installed in SN-2023-001 laptop'
  });

  // Add data validations
  // Asset Type column (column 4)
  worksheet.getColumn(4).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"standalone,component"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Asset Type',
        error: 'Please select standalone or component'
      };
    }
  });

  // Is Standby Asset column (column 6)
  worksheet.getColumn(6).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Standby Available column (column 7)
  worksheet.getColumn(7).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Value',
        error: 'Please enter true or false'
      };
    }
  });

  // Status column (now column 8)
  worksheet.getColumn(8).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"available,assigned,in_use,under_repair,disposed"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Status',
        error: 'Please select a valid status'
      };
    }
  });

  // Condition column (now column 9)
  worksheet.getColumn(9).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"new,excellent,good,fair,poor"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Condition',
        error: 'Please select a valid condition'
      };
    }
  });

  // Importance column (column 10)
  worksheet.getColumn(10).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"critical,high,medium,low"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Importance',
        error: 'Please select a valid importance level: critical, high, medium, or low'
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 70 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'Serial Number', required: 'Yes', description: 'Unique serial number for the asset. Must be unique across all assets.' },
    { field: 'Product Name/ID', required: 'Yes', description: 'Product name OR Product ID from Products reference sheet. System will match both.' },
    { field: 'Asset Type', required: 'No', description: 'standalone (default) = regular assets. component = parts that can be installed in other assets (RAM, HDD, monitors). Components can exist as spare stock without a parent.' },
    { field: 'Parent Serial Number', required: 'No', description: 'Only for component type. Serial number of the parent asset. Leave empty for spare/stock components. Required only when installing a component.' },
    { field: 'Is Standby Asset', required: 'No', description: 'true/false (default: false). Set to true for assets in the standby pool. Standby assets cannot be assigned to users and appear in a separate pool view.' },
    { field: 'Standby Available', required: 'No', description: 'true/false. Only applicable for standby assets. Indicates if the standby asset is available for assignment.' },
    { field: 'Status', required: 'No', description: 'Asset status: available, assigned, in_use, under_repair, disposed (default: available)' },
    { field: 'Condition', required: 'No', description: 'Asset condition: new, excellent, good, fair, poor (default: good)' },
    { field: 'Importance', required: 'No', description: 'Asset importance level: critical, high, medium, low (default: medium). Critical assets are essential for operations.' },
    { field: 'Purchase Date', required: 'No', description: 'Purchase date in YYYY-MM-DD format (e.g., 2023-01-15)' },
    { field: 'Purchase Cost', required: 'No', description: 'Purchase cost in numbers only (e.g., 45000)' },
    { field: 'Warranty End Date', required: 'No', description: 'Warranty end date in YYYY-MM-DD format' },
    { field: 'Assigned To', required: 'No', description: 'User email OR Employee ID from Users reference sheet. Asset inherits location from assigned user. Required if status is "assigned". Cannot be used for components or standby assets.' },
    { field: 'Installation Notes', required: 'No', description: 'Notes about component installation. Only applicable for component type.' },
    { field: 'Notes', required: 'No', description: 'Any additional notes or comments about the asset' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'IMPORTANT NOTES:', required: '', description: '' });
  const notesHeaderRow = instructionsSheet.lastRow;
  notesHeaderRow.font = { bold: true };
  notesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' }
  };

  const notes = [
    '• Fields marked with * are required',
    '• Serial numbers must be unique across all assets',
    '• Asset Tag and Tag Number will be auto-generated by the system',
    '• You can use either Product Name or Product ID (see Products sheet)',
    '• You can use either User Email or Employee ID for assignment (see Users sheet)',
    '',
    'ASSET TYPES:',
    '• Standalone (default): Regular assets like laptops, printers - can be assigned to users',
    '• Component: Parts like RAM, HDD, monitors - CANNOT be assigned to users directly',
    '• Components can be spare stock (no parent) or installed (with parent serial number)',
    '',
    'STANDBY ASSETS:',
    '• Set "Is Standby Asset" = true for assets in the standby pool',
    '• Standby assets appear in a separate pool view, not in regular inventory',
    '• Standby assets CANNOT be assigned to users directly',
    '• Use "Standby Available" to track availability',
    '',
    'COMPONENT MANAGEMENT:',
    '• Spare components: Leave "Parent Serial Number" empty',
    '• Installed components: Provide parent asset serial number',
    '• Components inherit assignment from their parent asset',
    '',
    'GENERAL RULES:',
    '• Assets inherit location from the assigned user - no need to specify location',
    '• If status is "assigned", Assigned To field is required',
    '• Components and Standby assets cannot have "Assigned To"',
    '• Dates should be in YYYY-MM-DD format',
    '• Delete the sample rows before uploading your data',
    '• Maximum 10,000 rows per upload'
  ];

  notes.forEach(note => {
    instructionsSheet.addRow({ field: '', required: '', description: note });
  });

  // Create Additional Software sheet
  const softwareSheet = workbook.addWorksheet('Additional Software');
  softwareSheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Serial Number*', key: 'serial_number', width: 20 },
    { header: 'Software Type*', key: 'software_type', width: 18 },
    { header: 'Software Name*', key: 'software_name', width: 30 },
    { header: 'License Key', key: 'license_key', width: 35 },
    { header: 'License Type', key: 'license_type', width: 18 },
    { header: 'Activation Date', key: 'activation_date', width: 18 },
    { header: 'Expiration Date', key: 'expiration_date', width: 18 },
    { header: 'Notes', key: 'notes', width: 35 }
  ];

  const softwareHeaderRow = softwareSheet.getRow(1);
  softwareHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  softwareHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  softwareHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
  softwareHeaderRow.height = 25;

  // Add sample rows
  softwareSheet.addRow({
    row_number: 1,
    serial_number: 'SN-2023-001',
    software_type: 'application',
    software_name: 'Adobe Acrobat Pro',
    license_key: 'AAAAA-BBBBB-CCCCC-DDDDD',
    license_type: 'retail',
    activation_date: '2023-01-20',
    expiration_date: '',
    notes: 'Additional software beyond OS and Office'
  });

  softwareSheet.addRow({
    row_number: 2,
    serial_number: 'SN-2023-001',
    software_type: 'application',
    software_name: 'AutoCAD 2024',
    license_key: '',
    license_type: 'subscription',
    activation_date: '2024-01-01',
    expiration_date: '2025-12-31',
    notes: 'Annual subscription'
  });

  // Add data validation for Software Type
  softwareSheet.getColumn(3).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"operating_system,application,utility,driver"'],
        showErrorMessage: true,
        errorTitle: 'Invalid Software Type',
        error: 'Please select a valid software type from the list'
      };
    }
  });

  // Add data validation for License Type
  softwareSheet.getColumn(6).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"oem,retail,volume,subscription"'],
        showErrorMessage: true,
        errorTitle: 'Invalid License Type',
        error: 'Please select a valid license type from the list'
      };
    }
  });

  // Create Products reference sheet
  const productsSheet = workbook.addWorksheet('Products Reference');
  productsSheet.columns = [
    { header: 'Product ID', key: 'id', width: 40 },
    { header: 'Product Name', key: 'name', width: 30 },
    { header: 'Model', key: 'model', width: 20 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'OEM', key: 'oem', width: 20 }
  ];

  const productsHeaderRow = productsSheet.getRow(1);
  productsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  productsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFF6B6B' }
  };
  productsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  products.forEach(product => {
    productsSheet.addRow({
      id: product.id,
      name: product.name,
      model: product.model || '',
      category: product.category_name || '',
      oem: product.oem_name || ''
    });
  });

  // Create Users reference sheet
  const usersSheet = workbook.addWorksheet('Users Reference');
  usersSheet.columns = [
    { header: 'User ID', key: 'id', width: 40 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Employee ID', key: 'employee_id', width: 20 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Department', key: 'department', width: 25 }
  ];

  const usersHeaderRow = usersSheet.getRow(1);
  usersHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  usersHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF95E1D3' }
  };
  usersHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  users.forEach(user => {
    usersSheet.addRow({
      id: user.user_id,
      email: user.email,
      employee_id: user.employee_id || '',
      name: `${user.first_name} ${user.last_name}`,
      department: user.department_name || ''
    });
  });

  // Create Vendors reference sheet
  const vendorsSheet = workbook.addWorksheet('Vendors Reference');
  vendorsSheet.columns = [
    { header: 'Vendor Name', key: 'name', width: 40 }
  ];

  const vendorsHeaderRow = vendorsSheet.getRow(1);
  vendorsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  vendorsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF9B59B6' }
  };
  vendorsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  vendors.forEach(vendor => {
    vendorsSheet.addRow({
      name: vendor.name
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Parse and validate legacy asset upload file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @param {Object} referenceData - Reference data for validation
 * @param {Array} referenceData.products - List of products
 * @param {Array} referenceData.users - List of users
 * @param {Array} referenceData.existingSerialNumbers - Existing serial numbers in DB
 * @param {Array} referenceData.existingAssetTags - Existing asset tags in DB
 * @returns {Promise<Object>} Validation results with categorized rows
 */
async function parseLegacyAssetFile(fileBuffer, referenceData) {
  const { products, users, vendors = [], existingSerialNumbers, existingAssetTags } = referenceData;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Assets');
  if (!worksheet) {
    throw new Error('Assets worksheet not found in file');
  }

  const validRows = [];
  const warningRows = [];
  const errorRows = [];

  const seenSerialNumbers = new Set();

  // Create lookup maps for faster matching
  const productsByName = new Map();
  const productsById = new Map();
  products.forEach(p => {
    productsByName.set(p.name.toLowerCase().trim(), p);
    productsById.set(p.id.toLowerCase(), p);
  });

  const usersByEmail = new Map();
  const usersByEmployeeId = new Map();
  users.forEach(u => {
    usersByEmail.set(u.email.toLowerCase().trim(), u);
    if (u.employee_id) {
      usersByEmployeeId.set(u.employee_id.toLowerCase().trim(), u);
    }
  });

  // Create vendor lookup map
  const vendorsByName = new Map();
  vendors.forEach(v => {
    vendorsByName.set(v.name.toLowerCase().trim(), v);
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Skip header row and sample rows (rows 1-4)
    if (rowNumber <= 1) return;

    const rowData = {
      row_number: rowNumber,
      serial_number: row.getCell(2).value?.toString().trim() || '',
      product_input: row.getCell(3).value?.toString().trim() || '',
      asset_type: row.getCell(4).value?.toString().trim().toLowerCase() || 'standalone',
      parent_serial_number: row.getCell(5).value?.toString().trim() || null,
      is_standby_asset: row.getCell(6).value?.toString().trim().toLowerCase() === 'true',
      standby_available: row.getCell(7).value?.toString().trim().toLowerCase() === 'true',
      status: row.getCell(8).value?.toString().trim().toLowerCase() || 'available',
      condition_status: row.getCell(9).value?.toString().trim().toLowerCase() || 'good',
      importance: row.getCell(10).value?.toString().trim().toLowerCase() || 'medium',
      vendor_name: row.getCell(11).value?.toString().trim() || null,
      invoice_number: row.getCell(12).value?.toString().trim() || null,
      purchase_date: row.getCell(13).value || null,
      purchase_cost: row.getCell(14).value || null,
      warranty_start_date: row.getCell(15).value || null,
      warranty_end_date: row.getCell(16).value || null,
      eol_date: row.getCell(17).value || null,
      eos_date: row.getCell(18).value || null,
      assigned_to_input: row.getCell(19).value?.toString().trim() || '',
      installation_notes: row.getCell(20).value?.toString().trim() || null,
      notes: row.getCell(21).value?.toString().trim() || null,
      additional_software: [] // Will be populated from Additional Software sheet
    };

    const errors = [];
    const warnings = [];

    // Validate required fields
    if (!rowData.serial_number) {
      errors.push('Serial number is required');
    }
    if (!rowData.product_input) {
      errors.push('Product is required');
    }

    // Check for duplicates within file
    if (rowData.serial_number) {
      if (seenSerialNumbers.has(rowData.serial_number.toLowerCase())) {
        errors.push('Duplicate serial number within file');
      } else {
        seenSerialNumbers.add(rowData.serial_number.toLowerCase());
      }
    }

    // Check for duplicates in database
    if (rowData.serial_number && existingSerialNumbers.includes(rowData.serial_number.toLowerCase())) {
      errors.push('Serial number already exists in database');
    }

    // Match product (by ID or name)
    let product = null;
    if (rowData.product_input) {
      product = productsById.get(rowData.product_input.toLowerCase()) ||
                productsByName.get(rowData.product_input.toLowerCase());

      if (!product) {
        errors.push(`Product not found: ${rowData.product_input}`);
      }
    }

    // Match user if assigned_to is provided (asset will inherit location from user)
    let assignedUser = null;
    if (rowData.assigned_to_input) {
      assignedUser = usersByEmail.get(rowData.assigned_to_input.toLowerCase()) ||
                     usersByEmployeeId.get(rowData.assigned_to_input.toLowerCase());

      if (!assignedUser) {
        errors.push(`User not found: ${rowData.assigned_to_input}`);
      }
    }

    // Match vendor if vendor_name is provided
    let vendor = null;
    if (rowData.vendor_name) {
      vendor = vendorsByName.get(rowData.vendor_name.toLowerCase());
      if (!vendor) {
        warnings.push(`Vendor not found: ${rowData.vendor_name}. Will be left empty.`);
      }
    }

    // Validate status
    const validStatuses = ['available', 'assigned', 'in_use', 'under_repair', 'disposed'];
    if (!validStatuses.includes(rowData.status)) {
      errors.push(`Invalid status: ${rowData.status}`);
    }

    // Validate condition
    const validConditions = ['new', 'excellent', 'good', 'fair', 'poor'];
    if (!validConditions.includes(rowData.condition_status)) {
      errors.push(`Invalid condition: ${rowData.condition_status}`);
    }

    // Validate importance
    const validImportance = ['critical', 'high', 'medium', 'low'];
    if (!validImportance.includes(rowData.importance)) {
      errors.push(`Invalid importance: ${rowData.importance}. Must be 'critical', 'high', 'medium', or 'low'`);
    }

    // Validate asset_type
    const validAssetTypes = ['standalone', 'component'];
    if (!validAssetTypes.includes(rowData.asset_type)) {
      errors.push(`Invalid asset_type: ${rowData.asset_type}. Must be 'standalone' or 'component'`);
    }

    // Validate component must have parent_serial_number
    if (rowData.asset_type === 'component' && !rowData.parent_serial_number) {
      errors.push('Components must have a Parent Serial Number');
    }

    // Validate standalone should not have parent_serial_number
    if (rowData.asset_type === 'standalone' && rowData.parent_serial_number) {
      errors.push('Standalone assets cannot have a Parent Serial Number');
    }

    // Components cannot be assigned to users directly
    if (rowData.asset_type === 'component' && rowData.assigned_to_input) {
      errors.push('Components cannot be assigned to users. Only parent assets can be assigned.');
    }

    // Check if assigned_to is required when status is assigned
    if (rowData.status === 'assigned' && !rowData.assigned_to_input) {
      errors.push('Assigned To is required when status is "assigned"');
    }

    // Warnings for optional fields
    if (!rowData.purchase_date) {
      warnings.push('Purchase date not provided');
    }
    if (!rowData.purchase_cost) {
      warnings.push('Purchase cost not provided');
    }

    // Prepare final row data with resolved IDs
    const finalRowData = {
      ...rowData,
      product_id: product?.id || null,
      product_name: product?.name || rowData.product_input,
      assigned_to: assignedUser?.user_id || null,
      assigned_user_name: assignedUser ? `${assignedUser.first_name} ${assignedUser.last_name}` : null,
      vendor_id: vendor?.id || null,
      asset_type: rowData.asset_type,
      parent_serial_number: rowData.parent_serial_number,
      installation_notes: rowData.installation_notes,
      errors,
      warnings
    };

    // Categorize row
    if (errors.length > 0) {
      errorRows.push(finalRowData);
    } else if (warnings.length > 0) {
      warningRows.push(finalRowData);
    } else {
      validRows.push(finalRowData);
    }
  });

  // Parse Additional Software sheet if it exists
  const softwareSheet = workbook.getWorksheet('Additional Software');
  if (softwareSheet) {
    const additionalSoftware = [];

    softwareSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // Skip header row
      if (rowNumber === 1) return;

      const serialNumber = row.getCell(2).value?.toString().trim();
      const softwareType = row.getCell(3).value?.toString().trim();
      const softwareName = row.getCell(4).value?.toString().trim();

      // Skip empty rows
      if (!serialNumber || !softwareName) return;

      const softwareData = {
        row_number: row.getCell(1).value,
        serial_number: serialNumber,
        software_type: softwareType || 'application',
        software_name: softwareName,
        license_key: row.getCell(5).value?.toString().trim() || null,
        license_type: row.getCell(6).value?.toString().trim() || 'retail',
        activation_date: row.getCell(7).value || null,
        expiration_date: row.getCell(8).value || null,
        notes: row.getCell(9).value?.toString().trim() || null
      };

      additionalSoftware.push(softwareData);
    });

    // Map additional software to assets by serial number (across all categories)
    const allRows = [...validRows, ...warningRows, ...errorRows];
    additionalSoftware.forEach(software => {
      const asset = allRows.find(a => a.serial_number === software.serial_number);
      if (asset) {
        asset.additional_software.push(software);
      } else {
        console.warn(`Warning: Additional software for serial number '${software.serial_number}' not found in Assets sheet`);
      }
    });
  }

  return {
    valid: validRows,
    warnings: warningRows,
    errors: errorRows,
    summary: {
      total: validRows.length + warningRows.length + errorRows.length,
      valid: validRows.length,
      warnings: warningRows.length,
      errors: errorRows.length
    }
  };
}

/**
 * Generate location bulk upload template
 * @param {Object} options - Options containing clients and location types
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateLocationBulkTemplate({ clients, locationTypes }) {
  const workbook = new ExcelJS.Workbook();

  // Create main Locations sheet
  const worksheet = workbook.addWorksheet('Locations', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns
  worksheet.columns = [
    { header: 'Row', key: 'row_number', width: 8 },
    { header: 'Location Name*', key: 'name', width: 30 },
    { header: 'Address*', key: 'address', width: 40 },
    { header: 'Client Name/ID*', key: 'client', width: 30 },
    { header: 'Location Type Name/ID*', key: 'location_type', width: 25 },
    { header: 'Contact Person*', key: 'contact_person', width: 25 },
    { header: 'Contact Email*', key: 'contact_email', width: 30 },
    { header: 'Contact Phone', key: 'contact_phone', width: 20 },
    { header: 'State', key: 'state_name', width: 20 },
    { header: 'City', key: 'city_name', width: 20 },
    { header: 'Area', key: 'area_name', width: 20 },
    { header: 'Pincode', key: 'pincode', width: 15 },
    { header: 'Parent Location Name', key: 'parent_location', width: 30 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add 3 sample rows
  worksheet.addRow({
    row_number: 1,
    name: 'Mumbai Office - Admin Block',
    address: 'Nariman Point, Mumbai',
    client: clients.length > 0 ? clients[0].client_name : 'Acme Corp',
    location_type: locationTypes.length > 0 ? locationTypes[0].location_type : 'Office',
    contact_person: 'John Doe',
    contact_email: 'john.doe@example.com',
    contact_phone: '+91-9876543210',
    state_name: 'Maharashtra',
    city_name: 'Mumbai',
    area_name: 'Nariman Point',
    pincode: '400021',
    parent_location: ''
  });

  worksheet.addRow({
    row_number: 2,
    name: 'Delhi Office - IT Wing',
    address: 'Connaught Place, New Delhi',
    client: clients.length > 0 ? clients[0].id : '',
    location_type: locationTypes.length > 0 ? locationTypes[0].id : '',
    contact_person: 'Jane Smith',
    contact_email: 'jane.smith@example.com',
    contact_phone: '+91-9876543211',
    state_name: 'Delhi',
    city_name: 'New Delhi',
    area_name: 'Connaught Place',
    pincode: '110001',
    parent_location: ''
  });

  worksheet.addRow({
    row_number: 3,
    name: 'Bangalore Office',
    address: 'Whitefield, Bangalore',
    client: '',
    location_type: '',
    contact_person: '',
    contact_email: '',
    contact_phone: '',
    state_name: 'Karnataka',
    city_name: 'Bangalore',
    area_name: 'Whitefield',
    pincode: '560066',
    parent_location: ''
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.columns = [
    { header: 'Field', key: 'field', width: 30 },
    { header: 'Required', key: 'required', width: 12 },
    { header: 'Description', key: 'description', width: 70 }
  ];

  // Style instructions header
  const instrHeaderRow = instructionsSheet.getRow(1);
  instrHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instrHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF70AD47' }
  };
  instrHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  // Add instructions
  const instructions = [
    { field: 'Location Name', required: 'Yes', description: 'Unique name for the location (e.g., "Mumbai Office - Admin Block")' },
    { field: 'Address', required: 'Yes', description: 'Full address of the location' },
    { field: 'Client Name/ID', required: 'Yes', description: 'Client name OR Client ID from Clients reference sheet' },
    { field: 'Location Type Name/ID', required: 'Yes', description: 'Location type name OR ID from Location Types reference sheet' },
    { field: 'Contact Person', required: 'Yes', description: 'Name of the primary contact person at this location' },
    { field: 'Contact Email', required: 'Yes', description: 'Valid email address of the contact person' },
    { field: 'Contact Phone', required: 'No', description: 'Phone number of the contact person (e.g., +91-9876543210)' },
    { field: 'State', required: 'No', description: 'State name (e.g., Maharashtra, Delhi, Karnataka)' },
    { field: 'City', required: 'No', description: 'City name (e.g., Mumbai, New Delhi, Bangalore)' },
    { field: 'Area', required: 'No', description: 'Area/locality name (e.g., Nariman Point, Connaught Place)' },
    { field: 'Pincode', required: 'No', description: 'Postal pincode (e.g., 400021, 110001)' },
    { field: 'Parent Location', required: 'No', description: 'Name of parent location if this is a sub-location (must exist in the system)' }
  ];

  instructions.forEach(instr => instructionsSheet.addRow(instr));

  // Add notes section
  instructionsSheet.addRow({});
  instructionsSheet.addRow({ field: 'IMPORTANT NOTES:', required: '', description: '' });
  const notesHeaderRow = instructionsSheet.lastRow;
  notesHeaderRow.font = { bold: true };
  notesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE7E6E6' }
  };

  const notes = [
    '• Fields marked with * are required',
    '• Location names should be unique and descriptive',
    '• You can use either Client Name or Client ID (see Clients sheet)',
    '• You can use either Location Type Name or ID (see Location Types sheet)',
    '• Contact email must be valid and unique',
    '• Parent Location is optional - use it only for sub-locations',
    '• Delete the sample rows before uploading your data',
    '• Maximum 1,000 rows per upload'
  ];

  notes.forEach(note => {
    instructionsSheet.addRow({ field: '', required: '', description: note });
  });

  // Create Clients reference sheet
  const clientsSheet = workbook.addWorksheet('Clients Reference');
  clientsSheet.columns = [
    { header: 'Client ID', key: 'id', width: 40 },
    { header: 'Client Name', key: 'client_name', width: 30 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  const clientsHeaderRow = clientsSheet.getRow(1);
  clientsHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  clientsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFF6B6B' }
  };
  clientsHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  clients.forEach(client => {
    clientsSheet.addRow({
      id: client.id,
      client_name: client.client_name,
      status: client.is_active ? 'Active' : 'Inactive'
    });
  });

  // Create Location Types reference sheet
  const typesSheet = workbook.addWorksheet('Location Types Reference');
  typesSheet.columns = [
    { header: 'Location Type ID', key: 'id', width: 40 },
    { header: 'Location Type', key: 'location_type', width: 30 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  const typesHeaderRow = typesSheet.getRow(1);
  typesHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  typesHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4ECDC4' }
  };
  typesHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };

  locationTypes.forEach(type => {
    typesSheet.addRow({
      id: type.id,
      location_type: type.location_type,
      description: type.description || '',
      status: type.is_active ? 'Active' : 'Inactive'
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate bulk department upload Excel template
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateDepartmentBulkTemplate() {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('Departments', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns (* = required field)
  worksheet.columns = [
    { header: 'Department Name*', key: 'department_name', width: 30 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Contact Person Email', key: 'contact_person_email', width: 30 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add sample data rows with realistic examples
  const sampleData = [
    {
      department_name: 'Information Technology',
      description: 'Manages IT infrastructure, software development, and technical support',
      contact_person_email: 'it.head@company.com'
    },
    {
      department_name: 'Human Resources',
      description: 'Handles recruitment, employee relations, and organizational development',
      contact_person_email: 'hr.head@company.com'
    },
    {
      department_name: 'Finance & Accounting',
      description: 'Manages financial planning, budgeting, and accounting operations',
      contact_person_email: 'finance.head@company.com'
    },
    {
      department_name: 'Sales & Marketing',
      description: 'Drives business growth through sales strategies and marketing campaigns',
      contact_person_email: 'sales.head@company.com'
    },
    {
      department_name: 'Operations',
      description: 'Oversees daily business operations and process optimization',
      contact_person_email: ''
    }
  ];

  sampleData.forEach(data => {
    worksheet.addRow(data);
  });

  // Add data validation for required fields (highlight in yellow)
  worksheet.getColumn('department_name').eachCell({ includeEmpty: false }, (cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF99' }
      };
    }
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.getColumn(1).width = 80;

  const instructions = [
    { text: 'DEPARTMENT BULK UPLOAD INSTRUCTIONS', style: { bold: true, size: 16, color: { argb: 'FF0000FF' } } },
    { text: '', style: {} },
    { text: 'REQUIRED FIELDS (marked with *):', style: { bold: true, size: 12 } },
    { text: '1. Department Name* - Must be unique, 2-100 characters', style: {} },
    { text: '', style: {} },
    { text: 'OPTIONAL FIELDS:', style: { bold: true, size: 12 } },
    { text: '2. Description - Brief description of department (max 500 characters)', style: {} },
    { text: '3. Contact Person Email - Must be a valid email of an existing user in the system', style: {} },
    { text: '', style: {} },
    { text: 'IMPORTANT NOTES:', style: { bold: true, size: 12, color: { argb: 'FFFF0000' } } },
    { text: '- Required fields are highlighted in YELLOW', style: {} },
    { text: '- Do not modify the header row', style: {} },
    { text: '- Department names must be unique across the system', style: {} },
    { text: '- Contact Person Email must match an existing user email', style: {} },
    { text: '- Empty rows will be skipped', style: {} },
    { text: '- Maximum 1000 departments per upload', style: {} },
    { text: '', style: {} },
    { text: 'EXAMPLES:', style: { bold: true, size: 12 } },
    { text: '✓ Valid: "Information Technology", "Manages IT infrastructure...", "it.head@company.com"', style: { color: { argb: 'FF008000' } } },
    { text: '✓ Valid: "Human Resources", "Handles recruitment...", ""', style: { color: { argb: 'FF008000' } } },
    { text: '✗ Invalid: "", "Description", "email@example.com" (missing department name)', style: { color: { argb: 'FFFF0000' } } },
    { text: '✗ Invalid: "IT", "", "invalid-email" (invalid email format)', style: { color: { argb: 'FFFF0000' } } }
  ];

  instructions.forEach((instruction, index) => {
    const cell = instructionsSheet.getCell(`A${index + 1}`);
    cell.value = instruction.text;
    cell.font = instruction.style;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Parse department bulk upload file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {Promise<Array>} Parsed departments array
 */
async function parseDepartmentBulkFile(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('Departments');
  if (!worksheet) {
    throw new Error('Invalid template: "Departments" sheet not found');
  }

  const departments = [];
  const errors = [];

  worksheet.eachRow((row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return;

    const departmentName = row.getCell(1).value?.toString().trim();
    const description = row.getCell(2).value?.toString().trim() || null;
    const contactPersonEmail = row.getCell(3).value?.toString().trim() || null;

    // Skip empty rows
    if (!departmentName && !description && !contactPersonEmail) {
      return;
    }

    // Validate required fields
    if (!departmentName) {
      errors.push({
        row: rowNumber,
        error: 'Department Name is required'
      });
      return;
    }

    // Validate department name length
    if (departmentName.length < 2 || departmentName.length > 100) {
      errors.push({
        row: rowNumber,
        error: 'Department Name must be between 2 and 100 characters'
      });
      return;
    }

    // Validate description length
    if (description && description.length > 500) {
      errors.push({
        row: rowNumber,
        error: 'Description cannot exceed 500 characters'
      });
      return;
    }

    // Validate email format if provided
    if (contactPersonEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactPersonEmail)) {
        errors.push({
          row: rowNumber,
          error: 'Invalid email format for Contact Person Email'
        });
        return;
      }
    }

    departments.push({
      department_name: departmentName,
      description: description,
      contact_person_email: contactPersonEmail
    });
  });

  if (errors.length > 0) {
    const error = new Error('Validation errors found in upload file');
    error.validationErrors = errors;
    throw error;
  }

  if (departments.length === 0) {
    throw new Error('No valid department data found in file');
  }

  if (departments.length > 1000) {
    throw new Error('Maximum 1000 departments allowed per upload');
  }

  return departments;
}

/**
 * Generate bulk OEM upload Excel template
 * @returns {Promise<Buffer>} Excel file buffer
 */
async function generateOEMBulkTemplate() {
  const workbook = new ExcelJS.Workbook();

  // Create main sheet
  const worksheet = workbook.addWorksheet('OEMs', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Define columns (* = required field)
  worksheet.columns = [
    { header: 'OEM Name*', key: 'name', width: 30 },
    { header: 'Code*', key: 'code', width: 15 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Contact Person', key: 'contact_person', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 20 },
    { header: 'Website', key: 'website', width: 30 },
    { header: 'Address', key: 'address', width: 40 },
    { header: 'Status*', key: 'is_active', width: 12 }
  ];

  // Style header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 25;

  // Add sample data rows with realistic examples
  const sampleData = [
    {
      name: 'Dell Technologies',
      code: 'DELL',
      description: 'Global technology company specializing in computers, servers, and enterprise solutions',
      contact_person: 'John Smith',
      email: 'john.smith@dell.com',
      phone: '+1-800-555-3355',
      website: 'https://www.dell.com',
      address: 'One Dell Way, Round Rock, TX 78682, USA',
      is_active: 'Active'
    },
    {
      name: 'HP Inc.',
      code: 'HP',
      description: 'Leading provider of personal computing devices and imaging products',
      contact_person: 'Sarah Johnson',
      email: 'sarah.johnson@hp.com',
      phone: '+1-800-555-4774',
      website: 'https://www.hp.com',
      address: '1501 Page Mill Road, Palo Alto, CA 94304, USA',
      is_active: 'Active'
    },
    {
      name: 'Lenovo',
      code: 'LENOVO',
      description: 'Multinational technology company specializing in PCs, tablets, and smartphones',
      contact_person: 'Wei Chen',
      email: 'wei.chen@lenovo.com',
      phone: '+86-10-5886-8888',
      website: 'https://www.lenovo.com',
      address: 'No. 6 Chuangye Road, Haidian District, Beijing, China',
      is_active: 'Active'
    },
    {
      name: 'Microsoft Corporation',
      code: 'MSFT',
      description: 'Technology company producing software, hardware, and cloud services',
      contact_person: 'Emily Davis',
      email: 'emily.davis@microsoft.com',
      phone: '+1-425-882-8080',
      website: 'https://www.microsoft.com',
      address: 'One Microsoft Way, Redmond, WA 98052, USA',
      is_active: 'Active'
    },
    {
      name: 'Cisco Systems',
      code: 'CISCO',
      description: 'Networking hardware, software, and telecommunications equipment manufacturer',
      contact_person: 'Michael Brown',
      email: 'michael.brown@cisco.com',
      phone: '+1-408-526-4000',
      website: 'https://www.cisco.com',
      address: '170 West Tasman Drive, San Jose, CA 95134, USA',
      is_active: 'Active'
    }
  ];

  sampleData.forEach(data => {
    worksheet.addRow(data);
  });

  // Add data validation for required fields (highlight in yellow)
  ['name', 'code', 'is_active'].forEach(colKey => {
    worksheet.getColumn(colKey).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFFF99' }
        };
      }
    });
  });

  // Add data validation for Status dropdown
  worksheet.dataValidations.add('I2:I1000', {
    type: 'list',
    allowBlank: false,
    formulae: ['"Active,Inactive"']
  });

  // Create Instructions sheet
  const instructionsSheet = workbook.addWorksheet('Instructions');
  instructionsSheet.getColumn(1).width = 80;

  const instructions = [
    { text: 'OEM BULK UPLOAD INSTRUCTIONS', style: { bold: true, size: 16, color: { argb: 'FF0000FF' } } },
    { text: '', style: {} },
    { text: 'REQUIRED FIELDS (marked with *):', style: { bold: true, size: 12 } },
    { text: '1. OEM Name* - Full manufacturer/vendor name, must be unique (2-100 characters)', style: {} },
    { text: '2. Code* - Unique short code/identifier, uppercase (2-20 characters)', style: {} },
    { text: '3. Status* - Must be either "Active" or "Inactive"', style: {} },
    { text: '', style: {} },
    { text: 'OPTIONAL FIELDS:', style: { bold: true, size: 12 } },
    { text: '4. Description - Brief description of OEM (max 500 characters)', style: {} },
    { text: '5. Contact Person - Name of primary contact (max 100 characters)', style: {} },
    { text: '6. Email - Valid email address for OEM contact (max 255 characters)', style: {} },
    { text: '7. Phone - Contact phone number (max 20 characters)', style: {} },
    { text: '8. Website - OEM website URL (max 255 characters)', style: {} },
    { text: '9. Address - Physical address of OEM (max 500 characters)', style: {} },
    { text: '', style: {} },
    { text: 'IMPORTANT NOTES:', style: { bold: true, size: 12, color: { argb: 'FFFF0000' } } },
    { text: '- Required fields are highlighted in YELLOW', style: {} },
    { text: '- Do not modify the header row', style: {} },
    { text: '- OEM names and codes must be unique across the system', style: {} },
    { text: '- Code should be uppercase letters/numbers only (e.g., DELL, HP, CISCO)', style: {} },
    { text: '- Email must be in valid format (e.g., name@domain.com)', style: {} },
    { text: '- Phone can include country codes (e.g., +1-800-555-1234)', style: {} },
    { text: '- Website must include protocol (e.g., https://www.example.com)', style: {} },
    { text: '- Empty rows will be skipped', style: {} },
    { text: '- Maximum 1000 OEMs per upload', style: {} },
    { text: '', style: {} },
    { text: 'STATUS VALUES:', style: { bold: true, size: 12 } },
    { text: '• Active - OEM is currently active and available for selection', style: {} },
    { text: '• Inactive - OEM is deactivated (historical data only)', style: {} },
    { text: '', style: {} },
    { text: 'EXAMPLES:', style: { bold: true, size: 12 } },
    { text: '✓ Valid: "Dell Technologies", "DELL", "Global technology company...", "Active"', style: { color: { argb: 'FF008000' } } },
    { text: '✓ Valid: "HP Inc.", "HP", "", "", "contact@hp.com", "", "", "", "Active"', style: { color: { argb: 'FF008000' } } },
    { text: '✗ Invalid: "", "DELL", "Description", "Active" (missing OEM name)', style: { color: { argb: 'FFFF0000' } } },
    { text: '✗ Invalid: "Dell", "", "Description", "Active" (missing code)', style: { color: { argb: 'FFFF0000' } } },
    { text: '✗ Invalid: "Dell", "DELL", "", "", "invalid-email", "", "", "", "Active" (invalid email format)', style: { color: { argb: 'FFFF0000' } } }
  ];

  instructions.forEach((instruction, index) => {
    const cell = instructionsSheet.getCell(`A${index + 1}`);
    cell.value = instruction.text;
    cell.font = instruction.style;
    cell.alignment = { wrapText: true, vertical: 'top' };
  });

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Parse OEM bulk upload file
 * @param {Buffer} fileBuffer - Excel file buffer
 * @returns {Promise<Array>} Parsed OEMs array
 */
async function parseOEMBulkFile(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const worksheet = workbook.getWorksheet('OEMs');
  if (!worksheet) {
    throw new Error('Invalid template: "OEMs" sheet not found');
  }

  const oems = [];
  const errors = [];

  worksheet.eachRow((row, rowNumber) => {
    // Skip header row
    if (rowNumber === 1) return;

    const name = row.getCell(1).value?.toString().trim();
    const code = row.getCell(2).value?.toString().trim();
    const description = row.getCell(3).value?.toString().trim() || null;
    const contactPerson = row.getCell(4).value?.toString().trim() || null;
    const email = row.getCell(5).value?.toString().trim() || null;
    const phone = row.getCell(6).value?.toString().trim() || null;
    const website = row.getCell(7).value?.toString().trim() || null;
    const address = row.getCell(8).value?.toString().trim() || null;
    const status = row.getCell(9).value?.toString().trim();

    // Skip empty rows
    if (!name && !code && !status) {
      return;
    }

    // Validate required fields
    if (!name) {
      errors.push({
        row: rowNumber,
        error: 'OEM Name is required'
      });
      return;
    }

    if (!code) {
      errors.push({
        row: rowNumber,
        error: 'Code is required'
      });
      return;
    }

    if (!status) {
      errors.push({
        row: rowNumber,
        error: 'Status is required'
      });
      return;
    }

    // Validate name length
    if (name.length < 2 || name.length > 100) {
      errors.push({
        row: rowNumber,
        error: 'OEM Name must be between 2 and 100 characters'
      });
      return;
    }

    // Validate code length
    if (code.length < 2 || code.length > 20) {
      errors.push({
        row: rowNumber,
        error: 'Code must be between 2 and 20 characters'
      });
      return;
    }

    // Validate status
    if (!['Active', 'Inactive', 'active', 'inactive'].includes(status)) {
      errors.push({
        row: rowNumber,
        error: 'Status must be either "Active" or "Inactive"'
      });
      return;
    }

    // Validate optional field lengths
    if (description && description.length > 500) {
      errors.push({
        row: rowNumber,
        error: 'Description cannot exceed 500 characters'
      });
      return;
    }

    if (contactPerson && contactPerson.length > 100) {
      errors.push({
        row: rowNumber,
        error: 'Contact Person cannot exceed 100 characters'
      });
      return;
    }

    if (phone && phone.length > 20) {
      errors.push({
        row: rowNumber,
        error: 'Phone cannot exceed 20 characters'
      });
      return;
    }

    if (website && website.length > 255) {
      errors.push({
        row: rowNumber,
        error: 'Website cannot exceed 255 characters'
      });
      return;
    }

    if (address && address.length > 500) {
      errors.push({
        row: rowNumber,
        error: 'Address cannot exceed 500 characters'
      });
      return;
    }

    // Validate email format if provided
    if (email) {
      if (email.length > 255) {
        errors.push({
          row: rowNumber,
          error: 'Email cannot exceed 255 characters'
        });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.push({
          row: rowNumber,
          error: 'Invalid email format'
        });
        return;
      }
    }

    oems.push({
      name: name,
      code: code.toUpperCase(), // Force uppercase for codes
      description: description,
      contact_person: contactPerson,
      email: email,
      phone: phone,
      website: website,
      address: address,
      is_active: status.toLowerCase() === 'active'
    });
  });

  if (errors.length > 0) {
    const error = new Error('Validation errors found in upload file');
    error.validationErrors = errors;
    throw error;
  }

  if (oems.length === 0) {
    throw new Error('No valid OEM data found in file');
  }

  if (oems.length > 1000) {
    throw new Error('Maximum 1000 OEMs allowed per upload');
  }

  return oems;
}

module.exports = {
  generateUserUploadTemplate,
  generateAssetBulkTemplate,
  parseAssetBulkFile,
  generateLegacyAssetTemplate,
  parseLegacyAssetFile,
  generateLocationBulkTemplate,
  generateDepartmentBulkTemplate,
  parseDepartmentBulkFile,
  generateOEMBulkTemplate,
  parseOEMBulkFile
};
