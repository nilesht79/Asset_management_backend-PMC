/**
 * ASSET JOB REPORT PDF GENERATOR
 * Professional PDF documents for IT Asset Install, Move, and Transfer reports
 * with dynamic company logo - Based on Service Report PDF pattern
 */

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('../config/database');

class ConsumableRequestPDF {
  // Colors
static colors = {
  primary: '#1a365d',
  secondary: '#2b6cb0',
  success: '#38a169',
  warning: '#dd6b20',
  purple: '#805ad5',
  cyan: '#0891b2',
  gray: '#718096',
  lightGray: '#f7fafc',
  border: '#e2e8f0',
  white: '#ffffff',
  black: '#2d3748'
};




  // Job type configurations
//   static jobTypeConfig = {
//     install: {
//       title: 'IT ASSET INSTALL JOB REPORT',
//       color: '#38a169', // Green
//       description: 'First-time asset assignment to user'
//     },
//     move: {
//       title: 'IT ASSET MOVE JOB REPORT',
//       color: '#0891b2', // Cyan
//       description: 'Asset relocation / movement'
//     },
//     transfer: {
//       title: 'IT ASSET TRANSFER REPORT',
//       color: '#dd6b20', // Orange
//       description: 'Asset reassignment between users'
//     }
//   };

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
          WHERE config_key IN ('COMPANY_LOGO', 'COMPANY_NAME', 'COMPANY_ADDRESS', 'SHOW_COMPANY_NAME_IN_PDF')
        `);

      const settings = {};
      result.recordset.forEach(row => {
        settings[row.config_key] = row.config_value;
      });

      return {
        logo: settings.COMPANY_LOGO || null,
        name: settings.COMPANY_NAME || 'Unified ITSM Platform',
        address: settings.COMPANY_ADDRESS || '',
        showNameInPdf: settings.SHOW_COMPANY_NAME_IN_PDF === 'true' || settings.SHOW_COMPANY_NAME_IN_PDF === '1' || settings.SHOW_COMPANY_NAME_IN_PDF === undefined
      };
    } catch (error) {
      console.error('Error fetching company settings:', error);
      return { logo: null, name: 'Unified ITSM Platform', address: '' };
    }
  }


  static async generateRequest(request) {
  const companySettings =
    await this.getCompanySettings();

  return new Promise((resolve, reject) => {

    try {

      const doc = new PDFDocument({
        margin: 40,
        size: 'A4'
      });

      const chunks = [];

      doc.on('data',
        chunk => chunks.push(chunk)
      );

      doc.on('end',
        () => resolve(Buffer.concat(chunks))
      );

      doc.on('error', reject);

      this.renderRequest(
        doc,
        request,
        companySettings
      );

      doc.x = 40;
doc.y = 40;

   this.addFooter(doc);

      doc.end();

    } catch(error){
      reject(error);
    }

  });
}

static renderRequest(doc, request, companySettings) {

    const margin = 40;
    const pageWidth = doc.page.width - margin * 2;
    let y = margin;

    y = this.renderHeader(
        doc,
        request,
        companySettings,
        this.reportConfig,
        margin,
        y,
        pageWidth
    );

    // y = this.renderBanner(
    //     doc,
    //     this.reportConfig,
    //     margin,
    //     y,
    //     pageWidth
    // );

    const colWidth = (pageWidth - 10) / 2;

    const leftX = margin;
    const rightX = margin + colWidth + 10;

    let leftY = y;

    // ================= REQUISITION DETAILS =================

doc.font('Helvetica-Bold').fontSize(9).fillColor('#8B0000');

doc.text('Requisition No :', 40, y,{
    lineBreak:false
});
doc.text('Employee No. :', 40, y + 18,{
    lineBreak:false
});
doc.text('Department :', 40, y + 36,{
    lineBreak:false
});
doc.text('Location :', 40, y + 54,{
    lineBreak:false
});

doc.text('Name :', 240, y + 18,{
    lineBreak:false
});
doc.text('Section :', 240, y + 36,{
    lineBreak:false
});
doc.text('Floor :', 240, y + 54,{
    lineBreak:false
});
doc.text('Date :', 470, y,{
    lineBreak:false
});

doc.font('Helvetica').fillColor('#000');

doc.text(request.request_number || '-', 130, y);
doc.text(request.employee_id || '-', 130, y + 18);
doc.text(request.department_name || '-', 130, y + 36);
doc.text(request.location_name || '-', 130, y + 54);

doc.text(request.requested_by_name || '-', 275, y + 18);
doc.text(request.section_name || '-', 275, y + 36);
doc.text(request.floor || '-', 275, y + 54);

// Label
doc.font('Helvetica-Bold')
   .fontSize(9)
   .fillColor('#8B0000')
   .text('Date', 470, y);

// Value
doc.font('Helvetica')
   .fontSize(9)
   .fillColor('#000')
   .text(
      this.formatDate(request.created_at),
      505,
      y,
      {
         width: 90,
         lineBreak: false
      }
   );

// Move below this section
y += 90;

// ======================
// LIST OF ITEM REQUIRED
// ======================

doc.font('Helvetica-Bold')
   .fontSize(11)
   .fillColor('#000')
   .text('List of Item required', 40, y, {
      underline: true
   });

y += 22;

const startX = 40;
// const tableWidth = 515;


// Column widths
// const c1 = 105; // Asset Code
// const c2 = 150; // Item Name
// const c3 = 60;  // Required
// const c4 = 60;  // Issued
// const c5 = 60;  // Balance
// const c6 = 80;  // Remarks
const c1 = 105;
const c2 = 170;
const c3 = 70;  // Required
const c4 = 70;  // Issued
const c5 = 100; // Remarks


const tableWidth = c1 + c2 + c3 + c4 + c5;

const head1 = 30;
const head2 = 42;
const rowH = 55;

// Outer border
doc.rect(startX, y, tableWidth, head1 + head2 + rowH).stroke();

// Vertical lines
// Vertical lines
let xx = startX;

// Asset Code
xx += c1;
doc.moveTo(xx, y)
   .lineTo(xx, y + head1 + head2 + rowH)
   .stroke();

// Item Name
xx += c2;
doc.moveTo(xx, y)
   .lineTo(xx, y + head1 + head2 + rowH)
   .stroke();

// Header line only for Stationary/Consumables
doc.moveTo(xx, y + head1)
   .lineTo(xx + c3 + c4, y + head1)
   .stroke();

// Required Qty
xx += c3;
doc.moveTo(xx, y + head1)
   .lineTo(xx, y + head1 + head2 + rowH)
   .stroke();

// Issued Qty
xx += c4;
doc.moveTo(xx, y + head1)
   .lineTo(xx, y + head1 + head2 + rowH)
   .stroke();

// >>> THIS IS THE IMPORTANT LINE <<<
// Draw full-height line before Remarks
doc.moveTo(xx, y)
   .lineTo(xx, y + head1 + head2 + rowH)
   .stroke();

// Horizontal lines
doc.moveTo(startX, y + head1 + head2)
   .lineTo(startX + tableWidth, y + head1 + head2)
   .stroke();

// ================= Headers =================

doc.font('Helvetica-Bold').fontSize(9).fillColor('#8B0000');

doc.text('Asset Make / Model', startX + 8, y + 34,{
    lineBreak:false
});

doc.text('Item Name', startX + c1 + 10, y + 10,{
    lineBreak:false
});

doc.text(
    'Stationary / Consumables',
    startX + c1 + c2,
    y + 10,
    {
        // width: c3 + c4 + c5,
        width: c3 + c4,
        align: 'center',
        lineBreak: false
    }
);

// doc.text(
//     'Remarks',
//     startX + c1 + c2 + c3 + c4 + c5,
//     y + 15,
//     {
//         width: c6,
//         align: 'center',
//         lineBreak: false
//     }
// );
doc.text(
    'Remarks',
    startX + c1 + c2 + c3 + c4,
    y + 15,
    {
        width: c5,
        align: 'center',
        lineBreak: false
    }
);

// Second Header

doc.text(
    'Required\nQuantity',
    startX + c1 + c2,
    y + head1 + 6,
    {
        width: c3,
        align: 'center',
        lineBreak: false
    }
);

doc.text(
    'Issued\nQuantity',
    startX + c1 + c2 + c3,
    y + head1 + 6,
    {
        width: c4,
        align: 'center',
        lineBreak: false
    }
);

// doc.text(
//     'Balance\nQuantity',
//     startX + c1 + c2 + c3 + c4,
//     y + head1 + 6,
//     {
//         width: c5,
//         align: 'center',
//         lineBreak: false
//     }
// );

// ================= Data =================

const dataY = y + head1 + head2 + 8;

doc.font('Helvetica')
   .fontSize(9)
   .fillColor('#000');

doc.text(
    request.asset_model || '-',
    startX + 8,
    dataY
);

// doc.text(
//     request.asset_model || '-',
//     startX + 8,
//     dataY + 22,
//     {
//         width: c1 - 16,
//         align: 'center'
//     }
// );

doc.text(
    request.consumable_name || '-',
    startX + c1 + 10,
    dataY
);

doc.text(
    String(request.quantity_requested || 0),
    startX + c1 + c2,
    dataY,
    {
        width: c3,
        align: 'center'
    }
);

doc.text(
    String(request.quantity_issued || 0),
    startX + c1 + c2 + c3,
    dataY,
    {
        width: c4,
        align: 'center'
    }
);

// doc.text(
//     String(
//         (request.quantity_requested || 0) -
//         (request.quantity_issued || 0)
//     ),
//     startX + c1 + c2 + c3 + c4,
//     dataY,
//     {
//         width: c5,
//         align: 'center'
//     }
// );

// doc.text(
//     String(request.current_stock || 0),
//     startX + c1 + c2 + c3 + c4,
//     dataY,
//     {
//         width: c5,
//         align: 'center',
//         lineBreak: false
//     }
// );

// doc.text(
//     request.notes || '',
//     startX + c1 + c2 + c3 + c4 + c5 + 5,
//     dataY,
//     {
//         width: c6 - 10
//     }
// );


doc.text(
    request.notes || '',
    startX + c1 + c2 + c3 + c4 + 5,
    dataY,
    {
        width: c5 - 10
    }
);

// y += head1 + head2 + rowH + 35;
y += head1 + head2 + rowH + 10;


// ======================================================
// HOD DETAILS
// ======================================================

y += 8;

doc.font('Helvetica-Bold')
   .fontSize(9)
   .fillColor('#000')
   .text('HOD Details', 35, y + 30);

const boxY = y;

doc.rect(95, boxY, 88, 44).stroke();
doc.rect(196, boxY, 88, 44).stroke();
doc.rect(297, boxY, 88, 44).stroke();
doc.rect(398, boxY, 88, 44).stroke();
doc.rect(500, boxY, 55, 44).stroke();

doc.fontSize(7).font('Helvetica-Bold');

doc.text('Name',130,boxY-12);
doc.text('Designation',212,boxY-12);
doc.text('Department',304,boxY-12);
doc.text('Sub Section',398,boxY-12);
doc.text('Sign',494,boxY-12);

y = boxY + 54;


// ======================================================
// VERIFIED BY
// ======================================================

doc.font('Helvetica-Bold')
   .fontSize(8)
   .text('Verified by\n(FM)', 35, y);

const col1 = 95;
const col2 = 200;
const col3 = 305;
const col4 = 410;
const col5 = 505;

doc.font('Helvetica').fontSize(8);

doc.text('----------------', col1, y + 15, { width: 80, align: 'center' });

doc.text('----------------', col2, y + 15, { width: 80, align: 'center' });

// doc.text('Computer', col3, y + 5, { width: 80, align: 'center' });
doc.text('----------------', col3, y + 15, { width: 80, align: 'center' });

// doc.text('Data Center', col4, y + 5, { width: 80, align: 'center' });
doc.text('----------------', col4, y + 15, { width: 80, align: 'center' });

doc.text('----------------', col5, y + 15, { width: 80, align: 'center' });

y += 28;

// ======================================================
// ISSUED BY
// ======================================================

doc.font('Helvetica-Bold')
   .fontSize(8)
   .text('Issued By\n(DC)', 35, y);

doc.font('Helvetica').fontSize(8);

doc.text('----------------', col1, y + 15, { width: 80, align: 'center' });
doc.text('----------------', col2, y + 15, { width: 80, align: 'center' });

// doc.text('Computer', col3, y + 5, { width: 80, align: 'center' });
doc.text('----------------', col3, y + 15, { width: 80, align: 'center' });

// doc.text('Data Center', col4, y + 5, { width: 80, align: 'center' });
doc.text('----------------', col4, y + 15, { width: 80, align: 'center' });

doc.text('----------------', col5, y + 15, { width: 80, align: 'center' });

y += 28;

// ======================================================
// RECEIVED BY
// ======================================================

doc.font('Helvetica-Bold')
   .fontSize(8)
   .text('Received By', 35, y);

doc.font('Helvetica')
   .fontSize(8);

// Name
doc.text(
    request.requested_by_name || '',
    col1,
    y,
    {
        width: 80,
        align: 'center',
        lineBreak: false
    }
);

doc.text('----------------', col1, y + 22, {
    width: 80,
    align: 'center'
});

// Designation
doc.text(
    request.designation || '',
    col2,
    y,
    {
        width: 80,
        align: 'center',
        lineBreak: false
    }
);

doc.text('----------------', col2, y + 22, {
    width: 80,
    align: 'center'
});

// Department
doc.text(
    request.department_name || '',
    col3,
    y,
    {
        width: 80,
        align: 'center',
        lineBreak: false
    }
);

doc.text('----------------', col3, y + 22, {
    width: 80,
    align: 'center'
});

// Data Center / Location
doc.text(
    request.location_name || '',
    col4,
    y,
    {
        width: 80,
        align: 'center',
        lineBreak: false
    }
);

doc.text('----------------', col4, y + 22, {
    width: 80,
    align: 'center'
});

// Sign
doc.text('----------------', col5, y + 22, {
    width: 80,
    align: 'center'
});

y += 35;

// ======================================================
// APPROVED BY
// ======================================================

// Move close to bottom
y += 50;

doc.font('Helvetica')
   .fontSize(8)
   .text('----------------------', 465, y);

doc.font('Helvetica-Bold')
   .fontSize(8)
   .text('Approved by', 482, y + 12);


console.log(
    'Final Y Position:',
    doc.y,
    'Page Height:',
    doc.page.height
);

}



 static renderHeader(
    doc,
    request,
    companySettings,
    config,
    x,
    y,
    width
) {

    try {

        const logoPath = path.join(
            __dirname,
            '../../uploads/logos/CIDCO-Logo.png'
        );

        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 28, 18, {
                width: 85
            });
        }

    } catch (err) {
        console.log('Logo Error:', err);
    }

    // ================= HEADER =================

    doc
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor('#0B3EA8')
        .text('DATA CENTRE', 0, 24, {
            width: doc.page.width,
            align: 'center'
        });

    doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#0B3EA8')
        .text(
            'CITY AND INDUSTRIAL DEVELOPMENT CORPORATION OF MAHARASHTRA LTD.',
            0,
            46,
            {
                width: doc.page.width,
                align: 'center'
            }
        );

    doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('black')
        .text(
            'COMPUTER CONSUMABLE REQUISITION SLIP',
            0,
            68,
            {
                width: doc.page.width,
                align: 'center',
                underline: true
            }
        );

    doc
        .moveTo(40, 95)
        .lineTo(555, 95)
        .strokeColor('#d5d5d5')
        .stroke();

    return 110;
}
 
  /**
   * Render info box with label-value pairs (like service report)
   */
  static renderInfoBox(doc, title, x, y, width, rows) {
    const titleH = 16;
    const rowH = 12;
    const padding = 6;
    const boxH = titleH + rows.length * rowH + padding;

    // Border
    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.primary);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.white);
    doc.text(title, x + padding, y + 4, { width: width - padding * 2, lineBreak: false });

    // Rows
    let rowY = y + titleH + 3;
    rows.forEach(([label, value]) => {
      doc.font('Helvetica-Bold').fontSize(7).fillColor(this.colors.gray);
      doc.text(label + ':', x + padding, rowY, { width: 70, lineBreak: false });

      doc.font('Helvetica').fontSize(7).fillColor(this.colors.black);
      const displayValue = String(value || 'N/A').substring(0, 40);
      doc.text(displayValue, x + padding + 72, rowY, { width: width - padding * 2 - 72, lineBreak: false });

      rowY += rowH;
    });

    return y + boxH;
  }

  static renderBanner(doc, config, x, y, width) {
    doc.rect(x, y, width, 22).fill(config.color);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(this.colors.white);
    doc.text(config.title, x + 10, y + 6, { width: width - 20, lineBreak: false });

    return y + 28;
  }

  static renderPerformedBy(doc, report, x, y, width) {
    const boxH = 30;
    const padding = 8;

    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.gray);
    doc.text('Performed By:', x + padding, y + 8, { lineBreak: false });

    doc.font('Helvetica').fontSize(8).fillColor(this.colors.black);
    doc.text(report.performed_by_name || 'N/A', x + padding + 80, y + 8, { lineBreak: false });

    if (report.performed_by_email) {
      doc.font('Helvetica').fontSize(7).fillColor(this.colors.gray);
      doc.text(report.performed_by_email, x + padding + 80, y + 18, { lineBreak: false });
    }

    return y + boxH + 6;
  }

  /**
   * Render text box (remarks, notes)
   */
  static renderTextBox(doc, title, content, x, y, width) {
    const titleH = 14;
    const padding = 6;
    const maxTextH = 45;

    // Truncate content to prevent overflow
    const truncatedContent = content.length > 250 ? content.substring(0, 250) + '...' : content;
    const boxH = titleH + maxTextH + padding;

    // Border
    doc.rect(x, y, width, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();

    // Title bar
    doc.rect(x, y, width, titleH).fill(this.colors.lightGray);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(this.colors.primary);
    doc.text(title, x + padding, y + 3, { lineBreak: false });

    // Content - use save/restore to clip text within bounds
    doc.save();
    doc.rect(x + padding, y + titleH + padding, width - padding * 2, maxTextH - padding).clip();
    doc.font('Helvetica').fontSize(8).fillColor(this.colors.black);
    doc.text(truncatedContent, x + padding, y + titleH + padding, { width: width - padding * 2, lineBreak: true });
    doc.restore();

    // Reset cursor position
    doc.x = x;
    doc.y = y + boxH;

    return y + boxH + 4;
  }

  

  /**
   * Render signature section
   */
  static renderSignatureSection(doc, x, y, width) {
    const gap = 8;
    const boxWidth = (width - gap * 3) / 4;
    const boxH = 50;

    doc.font('Helvetica').fontSize(6).fillColor(this.colors.gray);

    // Requested By
    doc.rect(x, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('Requested By', x + 3, y + boxH - 18, { width: boxWidth - 6, align: 'center', lineBreak: false });
    doc.text('Signature & Date', x + 3, y + boxH - 10, { width: boxWidth - 6, align: 'center', lineBreak: false });

    // Coordinator
    const colItemX = x + boxWidth + gap;
    doc.rect(colItemX, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('Coordinator', colItemX + 3, y + boxH - 18, { width: boxWidth - 6, align: 'center', lineBreak: false });
    doc.text('Signature & Date', colItemX + 3, y + boxH - 10, { width: boxWidth - 6, align: 'center', lineBreak: false });

    // Engineer
    const colReqX = x + (boxWidth + gap) * 2;
    doc.rect(colReqX, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('Engineer', colReqX + 3, y + boxH - 18, { width: boxWidth - 6, align: 'center', lineBreak: false });
    doc.text('Signature & Date', colReqX + 3, y + boxH - 10, { width: boxWidth - 6, align: 'center', lineBreak: false });

    // Received By
    const colIssuedX = x + (boxWidth + gap) * 3;
    doc.rect(colIssuedX, y, boxWidth, boxH).strokeColor(this.colors.border).lineWidth(1).stroke();
    doc.text('Received By', colIssuedX + 3, y + boxH - 18, { width: boxWidth - 6, align: 'center', lineBreak: false });
    doc.text('Signature & Date', colIssuedX + 3, y + boxH - 10, { width: boxWidth - 6, align: 'center', lineBreak: false });
  }

  static addFooter(doc) {

    const footerY = doc.page.height - 38;

    doc
      .moveTo(40, footerY)
      .lineTo(555, footerY)
      .strokeColor('#000')
      .lineWidth(1)
      .stroke();

    doc.font('Helvetica')
       .fontSize(8)
       .fillColor('#000')
       .text(
          'Developed by Data Center',
          450,
          footerY + 8,
          {
      lineBreak: false
   }
       );
}

  // ===== UTILITY FUNCTIONS =====

  static formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }

  static formatDateTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }


}

module.exports = ConsumableRequestPDF;
