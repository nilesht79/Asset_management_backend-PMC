
const { connectDB, sql } = require('../config/database');

/**
 * Generate product code from product name.
 * Example: HP Laptop 400 G9 -> HP-LAPTOP
 */
function getProductCode(productName) {
  return productName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .split('-')
    .slice(0, 2)
    .join('-')
    .substring(0, 20);
}

/**
 * Generate the next asset tag using the highest existing sequence.
 */
async function generateAssetTag(productName, productId) {
  const pool = await connectDB();
  const productCode = getProductCode(productName);

  const result = await pool.request()
    .input('productId', sql.UniqueIdentifier, productId)
    .input('prefix', sql.VarChar(50), `${productCode}-%`)
    .query(`
      SELECT asset_tag
      FROM dbo.assets
      WHERE product_id = @productId
        AND asset_tag LIKE @prefix
    `);

  let maxSequence = 0;

  for (const row of result.recordset) {
    const match = row.asset_tag.match(
      new RegExp(`^${productCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
    );

    if (match) {
      maxSequence = Math.max(maxSequence, parseInt(match[1], 10));
    }
  }

  const nextSequence = maxSequence + 1;
  return `${productCode}-${String(nextSequence).padStart(3, '0')}`;
}

/**
 * Check whether an asset tag exists.
 * Include inactive records because the database unique index does.
 */
async function assetTagExists(assetTag) {
  const pool = await connectDB();

  const result = await pool.request()
    .input('assetTag', sql.VarChar(50), assetTag)
    .query(`
      SELECT TOP 1 id
      FROM dbo.assets
      WHERE asset_tag = @assetTag
    `);

  return result.recordset.length > 0;
}

/**
 * Generate a unique asset tag.
 */
async function generateUniqueAssetTag(productName, productId) {
  for (let attempts = 0; attempts < 20; attempts++) {
    const assetTag = await generateAssetTag(productName, productId);

    if (!(await assetTagExists(assetTag))) {
      return assetTag;
    }
  }

  throw new Error('Unable to generate a unique asset tag after multiple attempts');
}

/**
 * Generate tag number.
 */
async function generateTagNo(assetTag, locationId) {
  const pool = await connectDB();

  const locationPrefix = locationId
    ? locationId.substring(0, 3).toUpperCase()
    : 'ADM';

  const request = pool.request()
    .input('locationId', sql.UniqueIdentifier, locationId || null);

  const result = await request.query(`
    SELECT COUNT(*) + 1 AS next_sequence
    FROM dbo.assets a
    LEFT JOIN dbo.USER_MASTER u
      ON a.assigned_to = u.user_id
    WHERE
      (
        (@locationId IS NULL AND u.location_id IS NULL)
        OR u.location_id = @locationId
      )
      AND a.is_active = 1
  `);

  const sequence = result.recordset[0].next_sequence;
  return `${assetTag}/ADM-${locationPrefix}-${String(sequence).padStart(3, '0')}`;
}

async function tagNoExists(tagNo) {
  const pool = await connectDB();

  const result = await pool.request()
    .input('tagNo', sql.VarChar(100), tagNo)
    .query(`
      SELECT TOP 1 id
      FROM dbo.assets
      WHERE tag_no = @tagNo
    `);

  return result.recordset.length > 0;
}

async function generateUniqueTagNo(assetTag, locationId) {
  for (let attempts = 0; attempts < 20; attempts++) {
    const tagNo = await generateTagNo(assetTag, locationId);

    if (!(await tagNoExists(tagNo))) {
      return tagNo;
    }
  }

  throw new Error('Unable to generate a unique tag number after multiple attempts');
}

module.exports = {
  generateAssetTag,
  assetTagExists,
  generateUniqueAssetTag,
  generateTagNo,
  tagNoExists,
  generateUniqueTagNo
};
