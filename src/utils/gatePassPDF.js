/**
 * GATE PASS PDF GENERATOR
 * Professional PDF documents for Asset Gate Passes
 * - Disposal/Service: Assets going for scrap, buyback, or repair
 * - End User: Assets leaving with/to end users
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');

class GatePassPDF {
  // Colors
  static colors = {
    primary: '#1a365d',
    secondary: '#2b6cb0',
    success: '#38a169',
    warning: '#dd6b20',
    danger: '#e53e3e',
    purple: '#805ad5',
    cyan: '#0891b2',
    gray: '#718096',
    lightGray: '#f7fafc',
    border: '#e2e8f0',
    white: '#ffffff',
    black: '#2d3748'
  };

  // Gate pass type configurations
  static typeConfig = {
    disposal_service: {
      title: 'GATE PASS - DISPOSAL / SERVICE',
      subtitle: 'Asset Movement for Scrap, Buyback, or External Repair',
      color: '#dd6b20', // Orange
      purposeLabels: {
        scrap: 'Scrap / Disposal',
        buyback: 'Buyback / Sale',
        repair: 'External Repair / Service'
      }
    },
    end_user: {
      title: 'GATE PASS - END USER',
      subtitle: 'Asset Movement with End User',
      color: '#2b6cb0', // Blue
      purposeLabels: {
        new_assignment: 'New Assignment',
        temporary_handover: 'Temporary Handover',
        permanent_transfer: 'Permanent Transfer'
      }
    }
  };

  /**
   * Get company settings from database
   */
  static async getCompanySettings() {
    try {
      const pool = await connectDB();
      const result = await pool.request()
        .query(`
          SELECT config_key, config_value
          FROM system_config
          WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS', 'COMPANY_PHONE', 'COMPANY_EMAIL', 'SHOW_COMPANY_NAME_IN_PDF')
        `);

      const settings = {};
      result.recordset.forEach(row => {
        settings[row.config_key] = row.config_value;
      });

      return {
        logo: settings.COMPANY_LOGO || null,
        name: settings.COMPANY_NAME || 'Unified ITSM Platform',
        address: settings.COMPANY_ADDRESS || '',
        phone: settings.COMPANY_PHONE || '',
        email: settings.COMPANY_EMAIL || '',
        showNameInPdf: settings.SHOW_COMPANY_NAME_IN_PDF === 'true' || settings.SHOW_COMPANY_NAME_IN_PDF === '1' || settings.SHOW_COMPANY_NAME_IN_PDF === undefined
      };
    } catch (error) {
      console.error('Error fetching company settings:', error);
      return { logo: null, name: 'Unified ITSM Platform', address: '', phone: '', email: '' };
    }
  }

  /**
   * Generate Gate Pass PDF
   */
  static async generate(gatePass) {
    const companySettings = await this.getCompanySettings();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          margin: 40,
          size: 'A4',
          autoFirstPage: true
        });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.renderGatePass(doc, gatePass, companySettings);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Render full gate pass
   */
  static renderGatePass(doc, gatePass, companySettings) {
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    const maxY = doc.page.height - 180; // Leave space for security section and footer
    let y = margin;

    const typeConfig = this.typeConfig[gatePass.gate_pass_type] || this.typeConfig.disposal_service;

    // ===== HEADER WITH COMPANY LOGO =====
    y = this.renderHeader(doc, gatePass, companySettings, typeConfig, margin, y, pageWidth);

    // ===== GATE PASS INFO SECTION =====
    y = this.renderGatePassInfo(doc, gatePass, typeConfig, margin, y, pageWidth);

    // ===== FROM / TO SECTION =====
    y = this.renderFromToSection(doc, gatePass, margin, y, pageWidth);

    // ===== ASSETS TABLE =====
    y = this.renderAssetsTable(doc, gatePass.assets || [], margin, y, pageWidth, maxY);

    // ===== REMARKS =====
    if (gatePass.remarks && y < maxY - 60) {
      y = this.renderRemarks(doc, gatePass.remarks, margin, y, pageWidth);
    }

    // ===== AUTHORIZATION & SIGNATURES =====
    if (y < maxY) {
      y = this.renderSignatures(doc, gatePass, margin, y, pageWidth);
    }

    // ===== SECURITY SECTION =====
    this.renderSecuritySection(doc, margin, pageWidth);

    // ===== FOOTER =====
    this.renderFooter(doc, gatePass, companySettings);

    // Reset cursor to prevent auto page creation
    doc.x = margin;
    doc.y = margin;
  }

  /**
   * Render header with company logo
   */
  static renderHeader(doc, gatePass, companySettings, typeConfig, margin, y, pageWidth) {
    // Company logo
    if (companySettings.logo) {
      try {
        const logoPath = path.join(__dirname, '../../uploads/logos/', companySettings.logo);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, margin, y, { height: 50 });
        }
      } catch (e) {
        console.error('Error rendering logo:', e);
      }
    }

    // Company name and address (right aligned) - only if showNameInPdf is true or no logo
    if (companySettings.showNameInPdf || !companySettings.logo) {
      doc.font('Helvetica-Bold')
        .fontSize(14)
        .fillColor(this.colors.primary)
        .text(companySettings.name, margin + 100, y, {
          width: pageWidth - 100,
          align: 'right',
          lineBreak: false
        });

      if (companySettings.address) {
        doc.font('Helvetica')
          .fontSize(8)
          .fillColor(this.colors.gray)
          .text(companySettings.address, margin + 100, y + 18, {
            width: pageWidth - 100,
            align: 'right',
            lineBreak: false
          });
      }
    }

    y += 60;

    // Gate Pass Type Banner
    doc.rect(margin, y, pageWidth, 35)
      .fill(typeConfig.color);

    doc.font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(this.colors.white)
      .text(typeConfig.title, margin, y + 8, {
        width: pageWidth,
        align: 'center',
        lineBreak: false
      });

    y += 45;

    // Gate Pass Info Box
    doc.rect(margin, y, pageWidth, 45)
      .stroke(this.colors.border);

    const infoColWidth = pageWidth / 3;

    // Gate Pass No
    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Gate Pass No:', margin + 10, y + 8, { lineBreak: false });
    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.primary)
      .text(gatePass.gate_pass_number, margin + 10, y + 22, { lineBreak: false });

    // Date
    const issueDate = gatePass.issue_date
      ? new Date(gatePass.issue_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Date:', margin + infoColWidth + 10, y + 8, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.black)
      .text(issueDate, margin + infoColWidth + 10, y + 22, { lineBreak: false });

   // Time of Issue
    // const issueTime = gatePass.issue_date
    //   ? new Date(gatePass.issue_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    //   : '____________';

    const issueTime = gatePass.created_at
  ? new Date(gatePass.created_at).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  : '____________';

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Time of Issue:', margin + infoColWidth * 2 + 10, y + 8, { lineBreak: false });
    doc.font('Helvetica')
      .fontSize(10)
      .fillColor(this.colors.black)
      .text(issueTime, margin + infoColWidth * 2 + 10, y + 22, { lineBreak: false });

    // Reset cursor position
    doc.x = margin;
    doc.y = y + 55;

    return y + 55;
  }

  /**
   * Render gate pass info section
   */
  static renderGatePassInfo(doc, gatePass, typeConfig, margin, y, pageWidth) {
    const purposeLabel = typeConfig.purposeLabels[gatePass.purpose] || gatePass.purpose;

    doc.rect(margin, y, pageWidth, 30)
      .fill(this.colors.lightGray);

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.primary)
      .text('Purpose:', margin + 10, y + 8, { continued: true, lineBreak: false })
      .font('Helvetica')
      .fillColor(this.colors.black)
      .text(`  ${purposeLabel}`, { lineBreak: false });

    if (gatePass.gate_pass_type === 'disposal_service' && gatePass.expected_return_date) {
      const returnDate = new Date(gatePass.expected_return_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      doc.font('Helvetica')
        .fontSize(9)
        .fillColor(this.colors.gray)
        .text(`Expected Return: ${returnDate}`, margin + pageWidth - 180, y + 8, {
          width: 170,
          align: 'right',
          lineBreak: false
        });
    }

    // Reset cursor position
    doc.x = margin;
    doc.y = y + 40;

    return y + 40;
  }

  /**
   * Render From/To section
   */
  static renderFromToSection(doc, gatePass, margin, y, pageWidth) {
    const halfWidth = (pageWidth - 20) / 2;

    // FROM Box
    doc.rect(margin, y, halfWidth, 80)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.white);

    doc.rect(margin, y, halfWidth, 20)
      .fill(this.colors.primary);

    doc.text('FROM', margin, y + 5, {
      width: halfWidth,
      align: 'center',
      lineBreak: false
    });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text(gatePass.from_location_name || 'N/A', margin + 10, y + 28, {
        width: halfWidth - 20,
        lineBreak: false
      });

    if (gatePass.from_location_address) {
      doc.fontSize(8)
        .fillColor(this.colors.gray)
        .text(gatePass.from_location_address.substring(0, 50), margin + 10, y + 45, {
          width: halfWidth - 20,
          lineBreak: false
        });
    }

    // TO Box
    const toX = margin + halfWidth + 20;
    doc.rect(toX, y, halfWidth, 80)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.white);

    doc.rect(toX, y, halfWidth, 20)
      .fill(gatePass.gate_pass_type === 'disposal_service' ? this.colors.warning : this.colors.secondary);

    doc.text('TO', toX, y + 5, {
      width: halfWidth,
      align: 'center',
      lineBreak: false
    });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black);

    if (gatePass.gate_pass_type === 'disposal_service') {
      doc.text(gatePass.vendor_name || 'External Vendor/Service', toX + 10, y + 28, {
        width: halfWidth - 20,
        lineBreak: false
      });
      if (gatePass.destination_address) {
        doc.fontSize(8)
          .fillColor(this.colors.gray)
          .text(gatePass.destination_address.substring(0, 50), toX + 10, y + 45, {
            width: halfWidth - 20,
            lineBreak: false
          });
      }
      if (gatePass.carrier_name) {
        doc.fontSize(8)
          .fillColor(this.colors.gray)
          .text(`Carrier: ${gatePass.carrier_name}`, toX + 10, y + 58, {
            width: halfWidth - 20,
            lineBreak: false
          });
      }
    } else {
      doc.text(gatePass.recipient_name || 'N/A', toX + 10, y + 28, {
        width: halfWidth - 20,
        lineBreak: false
      });
      if (gatePass.recipient_employee_id) {
        doc.fontSize(8)
          .fillColor(this.colors.gray)
          .text(`Emp ID: ${gatePass.recipient_employee_id}`, toX + 10, y + 42, { lineBreak: false });
      }
      if (gatePass.recipient_department) {
        doc.text(`Dept: ${gatePass.recipient_department}`, toX + 10, y + 54, { lineBreak: false });
      }
      if (gatePass.recipient_location) {
        doc.text(`Location: ${gatePass.recipient_location}`, toX + 10, y + 66, { lineBreak: false });
      }
    }

    // Reset cursor position
    doc.x = margin;
    doc.y = y + 95;

    return y + 95;
  }

  /**
   * Render assets table
   */
  static renderAssetsTable(doc, assets, margin, y, pageWidth, maxY) {
    // Section header
    doc.font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.colors.primary)
      .text('ASSETS', margin, y, { lineBreak: false });

    y += 20;

    // Table header
    const colWidths = {
      sno: 30,
      assetTag: 80,
      description: 150,
      serial: 100,
      condition: 70,
      remarks: pageWidth - 430
    };

    doc.rect(margin, y, pageWidth, 22)
      .fill(this.colors.primary);

    let x = margin;
    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.white);

    doc.text('S.No', x + 5, y + 7, { width: colWidths.sno - 10, align: 'center', lineBreak: false });
    x += colWidths.sno;

    doc.text('Asset Tag', x + 5, y + 7, { width: colWidths.assetTag - 10, lineBreak: false });
    x += colWidths.assetTag;

    doc.text('Description', x + 5, y + 7, { width: colWidths.description - 10, lineBreak: false });
    x += colWidths.description;

    doc.text('Serial No.', x + 5, y + 7, { width: colWidths.serial - 10, lineBreak: false });
    x += colWidths.serial;

    doc.text('Condition', x + 5, y + 7, { width: colWidths.condition - 10, lineBreak: false });
    x += colWidths.condition;

    doc.text('Remarks', x + 5, y + 7, { width: colWidths.remarks - 10, lineBreak: false });

    y += 22;

    // Calculate max rows that can fit
    const rowHeight = 20;
    const availableHeight = (maxY || doc.page.height - 180) - y - 40;
    const maxRows = Math.floor(availableHeight / rowHeight);
    const displayAssets = assets.slice(0, Math.min(assets.length, maxRows > 0 ? maxRows : 5));

    // Table rows
    let sno = 0;
    displayAssets.forEach((asset, index) => {
      const isComponent = asset.parent_asset_id !== null;

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(margin, y, pageWidth, rowHeight)
          .fill(this.colors.lightGray);
      }

      doc.rect(margin, y, pageWidth, rowHeight)
        .stroke(this.colors.border);

      x = margin;
      doc.font('Helvetica')
        .fontSize(8)
        .fillColor(this.colors.black);

      // S.No (only for parent/standalone assets)
      if (!isComponent) {
        sno++;
        doc.text(sno.toString(), x + 5, y + 6, { width: colWidths.sno - 10, align: 'center', lineBreak: false });
      } else {
        doc.text('  -', x + 5, y + 6, { width: colWidths.sno - 10, align: 'center', lineBreak: false });
      }
      x += colWidths.sno;

      // Asset Tag (indented for components)
      const tagPrefix = isComponent ? '  └ ' : '';
      doc.text(tagPrefix + (asset.asset_tag || ''), x + 5, y + 6, { width: colWidths.assetTag - 10, lineBreak: false });
      x += colWidths.assetTag;

      // Description
      const desc = asset.product_name
        ? `${asset.product_name}${asset.model ? ' - ' + asset.model : ''}`
        : 'N/A';
      doc.text(desc, x + 5, y + 6, { width: colWidths.description - 10, lineBreak: false });
      x += colWidths.description;

      // Serial
      doc.text(asset.serial_number || '-', x + 5, y + 6, { width: colWidths.serial - 10, lineBreak: false });
      x += colWidths.serial;

      // Condition
      const condition = asset.condition_out || 'working';
      const conditionColors = {
        working: this.colors.success,
        damaged: this.colors.warning,
        for_repair: this.colors.cyan,
        faulty: this.colors.danger
      };
      doc.fillColor(conditionColors[condition] || this.colors.gray)
        .text(condition.charAt(0).toUpperCase() + condition.slice(1), x + 5, y + 6, { width: colWidths.condition - 10, lineBreak: false });
      x += colWidths.condition;

      // Remarks
      doc.fillColor(this.colors.gray)
        .text(asset.remarks || '-', x + 5, y + 6, { width: colWidths.remarks - 10, lineBreak: false });

      y += rowHeight;
    });

    // Total count
    y += 5;
    const totalText = assets.length > displayAssets.length
      ? `Total Assets: ${assets.length} (showing ${displayAssets.length})`
      : `Total Assets: ${sno}`;
    doc.font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.colors.primary)
      .text(totalText, margin + pageWidth - 150, y, { width: 150, align: 'right', lineBreak: false });

    // Reset cursor position
    doc.x = margin;
    doc.y = y + 25;

    return y + 25;
  }

  /**
   * Render remarks section
   */
  static renderRemarks(doc, remarks, margin, y, pageWidth) {
    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.primary)
      .text('Remarks:', margin, y, { lineBreak: false });

    y += 15;

    doc.rect(margin, y, pageWidth, 40)
      .stroke(this.colors.border);

    // Truncate remarks to prevent overflow
    const truncatedRemarks = remarks.length > 150 ? remarks.substring(0, 150) + '...' : remarks;

    // Use save/restore to clip text within bounds
    doc.save();
    doc.rect(margin + 5, y + 5, pageWidth - 10, 32).clip();
    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text(truncatedRemarks, margin + 10, y + 8, {
        width: pageWidth - 20
      });
    doc.restore();

    // Reset cursor position
    doc.x = margin;
    doc.y = y + 50;

    return y + 50;
  }

  /**
   * Render signatures section
   */
  static renderSignatures(doc, gatePass, margin, y, pageWidth) {
    const boxWidth = (pageWidth - 30) / 3;
    const boxHeight = 70;

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.primary)
      .text('AUTHORIZATION & VERIFICATION', margin, y, { lineBreak: false });

    y += 20;

    // Authorized By
    doc.rect(margin, y, boxWidth, boxHeight)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Authorized By', margin + 10, y + 8, { lineBreak: false });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text(gatePass.created_by_name || '_______________', margin + 10, y + 22, { lineBreak: false });

    doc.fontSize(8)
      .fillColor(this.colors.gray)
      .text('Signature: _____________', margin + 10, y + 50, { lineBreak: false });

    // Receiver / Handover To
    const recX = margin + boxWidth + 15;
    doc.rect(recX, y, boxWidth, boxHeight)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text(gatePass.gate_pass_type === 'end_user' ? 'Received By' : 'Handover To', recX + 10, y + 8, { lineBreak: false });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text('_______________', recX + 10, y + 22, { lineBreak: false });

    doc.fontSize(8)
      .fillColor(this.colors.gray)
      .text('Signature: _____________', recX + 10, y + 50, { lineBreak: false });

    // Security
    const secX = margin + (boxWidth + 15) * 2;
    doc.rect(secX, y, boxWidth, boxHeight)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Issued By', secX + 10, y + 8, { lineBreak: false });

    doc.font('Helvetica')
      .fontSize(9)
      .fillColor(this.colors.black)
      .text('_______________', secX + 10, y + 22, { lineBreak: false });

    doc.fontSize(8)
      .fillColor(this.colors.gray)
      .text('Signature: _____________', secX + 10, y + 50, { lineBreak: false });

    // Reset cursor position
    doc.x = margin;
    doc.y = y + boxHeight + 15;

    return y + boxHeight + 15;
  }

  /**
   * Render security check section
   */
  static renderSecuritySection(doc, margin, pageWidth) {
    const y = doc.page.height - 140;
    const halfWidth = (pageWidth - 20) / 2;

    doc.font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.colors.primary)
      .text('SECURITY VERIFICATION', margin, y, { lineBreak: false });

    const secY = y + 18;

    // Out verification
    doc.rect(margin, secY, halfWidth, 50)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(this.colors.gray)
      .text('Security Check - OUT', margin + 10, secY + 8, { lineBreak: false });

    doc.font('Helvetica')
      .fontSize(8)
      .text('Date/Time: ____________________', margin + 10, secY + 22, { lineBreak: false });
    doc.text('Guard Sign: ____________________', margin + 10, secY + 36, { lineBreak: false });

    // In verification
    const inX = margin + halfWidth + 20;
    doc.rect(inX, secY, halfWidth, 50)
      .stroke(this.colors.border);

    doc.font('Helvetica-Bold')
      .text('Security Check - IN (If Returned)', inX + 10, secY + 8, { lineBreak: false });

    doc.font('Helvetica')
      .text('Date/Time: ____________________', inX + 10, secY + 22, { lineBreak: false });
    doc.text('Guard Sign: ____________________', inX + 10, secY + 36, { lineBreak: false });

    // Reset cursor position
    doc.x = margin;
    doc.y = secY + 50;
  }

  /**
   * Render footer with company branding and page numbers
   */
  static renderFooter(doc, gatePass, companySettings) {
    const footerY = doc.page.height - 40;
    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;

    // Draw footer line
    doc.moveTo(margin, footerY - 5)
      .lineTo(margin + pageWidth, footerY - 5)
      .strokeColor(this.colors.border)
      .lineWidth(0.5)
      .stroke();

    // Save graphics state
    doc.save();

    // Footer text - left aligned with explicit positioning
    doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
    doc.text('Report Generated from Poleplus ITSM ©2026. Polestar Consulting Pvt. Ltd.',
      margin, footerY, { lineBreak: false }
    );

    // Page number - right aligned with explicit positioning
    doc.text('Page 1 of 1',
      margin + pageWidth - 80, footerY, { lineBreak: false }
    );

    // Restore graphics state to prevent blank page
    doc.restore();
  }
}

module.exports = GatePassPDF;
