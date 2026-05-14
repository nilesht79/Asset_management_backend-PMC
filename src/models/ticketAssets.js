/**
 * TICKET ASSETS MODEL
 * Handles linking assets to tickets
 */

const { connectDB, sql } = require('../config/database');

class TicketAssetsModel {
  /**
   * Link an asset to a ticket
   */
  static async linkAsset(ticketId, assetId, addedBy, notes = null) {
    try {
      const pool = await connectDB();

      const query = `
        INSERT INTO TICKET_ASSETS (
          id, ticket_id, asset_id, added_by, added_at, notes
        )
        OUTPUT INSERTED.*
        VALUES (
          NEWID(), @ticketId, @assetId, @addedBy, GETUTCDATE(), @notes
        )
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .input('addedBy', sql.UniqueIdentifier, addedBy)
        .input('notes', sql.NVarChar(500), notes)
        .query(query);

      return result.recordset[0];
    } catch (error) {
      // Handle duplicate link error
      if (error.number === 2627) {
        throw new Error('Asset is already linked to this ticket');
      }
      console.error('Error linking asset to ticket:', error);
      throw error;
    }
  }

  /**
   * Unlink an asset from a ticket
   */
  static async unlinkAsset(ticketId, assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(`
          DELETE FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId AND asset_id = @assetId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error unlinking asset from ticket:', error);
      throw error;
    }
  }

  /**
   * Get all assets linked to a ticket (includes components of linked parent assets)
   */
  static async getTicketAssets(ticketId, includeComponents = true) {
    try {
      const pool = await connectDB();

      const query = `
        -- Get directly linked assets
        SELECT
          ta.id,
          ta.ticket_id,
          ta.asset_id,
          ta.added_by,
          ta.added_at,
          ta.notes,
          -- Asset details
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.status AS asset_status,
          a.condition_status,
          a.parent_asset_id,
          -- Product details
          p.name AS product_name,
          p.model AS product_model,
          -- OEM details
          o.name AS oem_name,
          -- Category
          c.name AS category_name,
          -- Parent asset info (if component)
          pa.asset_tag AS parent_asset_tag,
          -- Added by user
          u.first_name + ' ' + u.last_name AS added_by_name,
          -- Flag to indicate if directly linked
          1 AS is_directly_linked,
          0 AS is_component_of_linked
        FROM TICKET_ASSETS ta
        INNER JOIN assets a ON ta.asset_id = a.id
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN assets pa ON a.parent_asset_id = pa.id
        LEFT JOIN USER_MASTER u ON ta.added_by = u.user_id
        WHERE ta.ticket_id = @ticketId

        ${includeComponents ? `
        UNION ALL

        -- Get components of linked parent assets
        SELECT
          NULL AS id,
          @ticketId AS ticket_id,
          comp.id AS asset_id,
          NULL AS added_by,
          NULL AS added_at,
          NULL AS notes,
          -- Component asset details
          comp.asset_tag,
          comp.serial_number,
          comp.asset_type,
          comp.status AS asset_status,
          comp.condition_status,
          comp.parent_asset_id,
          -- Component product details
          cp.name AS product_name,
          cp.model AS product_model,
          -- OEM details
          co.name AS oem_name,
          -- Category
          cc.name AS category_name,
          -- Parent asset tag
          parent.asset_tag AS parent_asset_tag,
          -- Added by user (from parent's link)
          pu.first_name + ' ' + pu.last_name AS added_by_name,
          -- Flag to indicate this is a component of linked asset
          0 AS is_directly_linked,
          1 AS is_component_of_linked
        FROM TICKET_ASSETS ta
        INNER JOIN assets parent ON ta.asset_id = parent.id
        INNER JOIN assets comp ON comp.parent_asset_id = parent.id
        INNER JOIN products cp ON comp.product_id = cp.id
        LEFT JOIN oems co ON cp.oem_id = co.id
        LEFT JOIN categories cc ON cp.category_id = cc.id
        LEFT JOIN USER_MASTER pu ON ta.added_by = pu.user_id
        WHERE ta.ticket_id = @ticketId
          AND parent.asset_type = 'parent'
          AND comp.asset_type = 'component'
          AND comp.is_active = 1
          -- Exclude components that are already directly linked to this ticket
          AND NOT EXISTS (
            SELECT 1 FROM TICKET_ASSETS ta2
            WHERE ta2.ticket_id = @ticketId AND ta2.asset_id = comp.id
          )
        ` : ''}

        ORDER BY is_directly_linked DESC, parent_asset_tag, asset_tag
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching ticket assets:', error);
      throw error;
    }
  }

  /**
   * Get all tickets linked to an asset
   */
  static async getAssetTickets(assetId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          ta.id,
          ta.ticket_id,
          ta.asset_id,
          ta.added_at,
          ta.notes,
          -- Ticket details
          t.ticket_number,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.category,
          t.created_at AS ticket_created_at,
          t.closed_at,
          t.resolution_notes,
          -- Engineer
          u.first_name + ' ' + u.last_name AS engineer_name
        FROM TICKET_ASSETS ta
        INNER JOIN TICKETS t ON ta.ticket_id = t.ticket_id
        LEFT JOIN USER_MASTER u ON t.assigned_to_engineer_id = u.user_id
        WHERE ta.asset_id = @assetId
        ORDER BY t.created_at DESC
      `;

      const result = await pool.request()
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching asset tickets:', error);
      throw error;
    }
  }

  /**
   * Link multiple assets to a ticket
   */
  static async linkMultipleAssets(ticketId, assetIds, addedBy) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const results = [];

        for (const assetId of assetIds) {
          const result = await transaction.request()
            .input('ticketId', sql.UniqueIdentifier, ticketId)
            .input('assetId', sql.UniqueIdentifier, assetId)
            .input('addedBy', sql.UniqueIdentifier, addedBy)
            .query(`
              IF NOT EXISTS (
                SELECT 1 FROM TICKET_ASSETS
                WHERE ticket_id = @ticketId AND asset_id = @assetId
              )
              BEGIN
                INSERT INTO TICKET_ASSETS (id, ticket_id, asset_id, added_by, added_at)
                OUTPUT INSERTED.*
                VALUES (NEWID(), @ticketId, @assetId, @addedBy, GETUTCDATE())
              END
            `);

          if (result.recordset.length > 0) {
            results.push(result.recordset[0]);
          }
        }

        await transaction.commit();
        return results;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error linking multiple assets:', error);
      throw error;
    }
  }

  /**
   * Check if asset is linked to ticket
   */
  static async isAssetLinked(ticketId, assetId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('assetId', sql.UniqueIdentifier, assetId)
        .query(`
          SELECT COUNT(*) AS count
          FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId AND asset_id = @assetId
        `);

      return result.recordset[0].count > 0;
    } catch (error) {
      console.error('Error checking asset link:', error);
      throw error;
    }
  }

  /**
   * Get employee's assigned assets (for ticket creation)
   * Includes standalone assets, parent assets, and their components
   */
  static async getEmployeeAssets(userId) {
    try {
      const pool = await connectDB();

      const query = `
        -- Get directly assigned assets (standalone and parent)
        SELECT
          a.id,
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          a.status,
          a.condition_status,
          a.parent_asset_id,
          ISNULL(l.name, 'N/A') AS location_name,
          ISNULL(d.department_name, 'N/A') AS department_name,
          NULL AS parent_asset_tag,
          p.name AS product_name,
          p.model AS product_model,
          o.name AS oem_name,
          c.name AS category_name,
          0 AS is_component_of_assigned
        FROM assets a
        INNER JOIN products p ON a.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN locations l ON TRY_CAST(a.location_id AS UNIQUEIDENTIFIER) = l.id
        LEFT JOIN DEPARTMENT_MASTER d ON TRY_CAST(a.department_id AS UNIQUEIDENTIFIER) = d.department_id
        WHERE a.assigned_to = @userId
          AND a.is_active = 1
          AND a.status <> 'retired'
          AND a.asset_type IN ('standalone', 'parent')

        UNION ALL

        -- Get components of assigned parent assets
        SELECT
          comp.id,
          comp.asset_tag,
          comp.serial_number,
          comp.asset_type,
          comp.status,
          comp.condition_status,
          comp.parent_asset_id,
          ISNULL(pl.name, 'N/A') AS location_name,
          ISNULL(pd.department_name, 'N/A') AS department_name,
          parent.asset_tag AS parent_asset_tag,
          p.name AS product_name,
          p.model AS product_model,
          o.name AS oem_name,
          c.name AS category_name,
          1 AS is_component_of_assigned
        FROM assets comp
        INNER JOIN assets parent ON comp.parent_asset_id = parent.id
        INNER JOIN products p ON comp.product_id = p.id
        LEFT JOIN oems o ON p.oem_id = o.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN locations pl ON TRY_CAST(parent.location_id AS UNIQUEIDENTIFIER) = pl.id
        LEFT JOIN DEPARTMENT_MASTER pd ON TRY_CAST(parent.department_id AS UNIQUEIDENTIFIER) = pd.department_id
        WHERE parent.assigned_to = @userId
          AND comp.is_active = 1
          AND comp.status <> 'retired'
          AND parent.status <> 'retired'
          AND comp.asset_type = 'component'

        ORDER BY asset_type, product_name, asset_tag
      `;

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching employee assets:', error);
      throw error;
    }
  }

  /**
   * Get software installed on employee's assigned assets (for ticket creation)
   * Returns software licenses installed on assets assigned to the user
   */
  static async getEmployeeSoftware(userId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          asi.id AS installation_id,
          asi.asset_id,
          asi.license_id,
          asi.installation_date,
          asi.installed_by,
          asi.license_type AS installation_license_type,
          -- Asset details
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          -- Product details (for asset)
          ap.name AS asset_product_name,
          ap.model AS asset_product_model,
          -- Software license details (if linked)
          sl.license_key,
          sl.license_type,
          sl.total_licenses,
          sl.expiration_date,
          sl.is_active AS license_is_active,
          -- Software product details (from software_product_id on installation)
          sp.name AS software_name,
          sp.model AS software_version,
          -- OEM/Vendor (from software product)
          o.name AS software_vendor
        FROM asset_software_installations asi
        INNER JOIN assets a ON asi.asset_id = a.id
        INNER JOIN products ap ON a.product_id = ap.id
        LEFT JOIN products sp ON asi.software_product_id = sp.id
        LEFT JOIN oems o ON sp.oem_id = o.id
        LEFT JOIN software_licenses sl ON asi.license_id = sl.id
        WHERE a.assigned_to = @userId
          AND a.is_active = 1
          AND a.status <> 'retired'
          AND asi.is_active = 1
        ORDER BY sp.name, a.asset_tag
      `;

      const result = await pool.request()
        .input('userId', sql.UniqueIdentifier, userId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching employee software:', error);
      throw error;
    }
  }

  /**
   * Link multiple software installations to a ticket
   */
  static async linkMultipleSoftware(ticketId, softwareInstallationIds, addedBy) {
    try {
      const pool = await connectDB();
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const results = [];

        for (const installationId of softwareInstallationIds) {
          const result = await transaction.request()
            .input('ticketId', sql.UniqueIdentifier, ticketId)
            .input('installationId', sql.UniqueIdentifier, installationId)
            .input('addedBy', sql.UniqueIdentifier, addedBy)
            .query(`
              IF NOT EXISTS (
                SELECT 1 FROM TICKET_SOFTWARE
                WHERE ticket_id = @ticketId AND software_installation_id = @installationId
              )
              BEGIN
                INSERT INTO TICKET_SOFTWARE (id, ticket_id, software_installation_id, added_by, added_at)
                OUTPUT INSERTED.*
                VALUES (NEWID(), @ticketId, @installationId, @addedBy, GETUTCDATE())
              END
            `);

          if (result.recordset.length > 0) {
            results.push(result.recordset[0]);
          }
        }

        await transaction.commit();
        return results;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error('Error linking multiple software installations:', error);
      throw error;
    }
  }

  /**
   * Get all software linked to a ticket
   */
  static async getTicketSoftware(ticketId) {
    try {
      const pool = await connectDB();

      const query = `
        SELECT
          ts.id AS link_id,
          ts.ticket_id,
          ts.software_installation_id,
          ts.added_by,
          ts.added_at,
          ts.notes,
          -- Installation details
          asi.installation_date,
          asi.license_type AS installation_license_type,
          -- Asset details
          a.id AS asset_id,
          a.asset_tag,
          a.serial_number,
          a.asset_type,
          -- Asset product
          ap.name AS asset_product_name,
          ap.model AS asset_product_model,
          -- Software product
          sp.name AS software_name,
          sp.model AS software_version,
          -- Vendor
          o.name AS software_vendor,
          -- License info
          sl.license_key,
          sl.license_type,
          sl.expiration_date,
          sl.is_active AS license_is_active,
          -- Added by user
          u.first_name + ' ' + u.last_name AS added_by_name
        FROM TICKET_SOFTWARE ts
        INNER JOIN asset_software_installations asi ON ts.software_installation_id = asi.id
        INNER JOIN assets a ON asi.asset_id = a.id
        INNER JOIN products ap ON a.product_id = ap.id
        LEFT JOIN products sp ON asi.software_product_id = sp.id
        LEFT JOIN oems o ON sp.oem_id = o.id
        LEFT JOIN software_licenses sl ON asi.license_id = sl.id
        LEFT JOIN USER_MASTER u ON ts.added_by = u.user_id
        WHERE ts.ticket_id = @ticketId
        ORDER BY sp.name, a.asset_tag
      `;

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(query);

      return result.recordset;
    } catch (error) {
      console.error('Error fetching ticket software:', error);
      throw error;
    }
  }

  /**
   * Unlink software from a ticket
   */
  static async unlinkSoftware(ticketId, softwareInstallationId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .input('installationId', sql.UniqueIdentifier, softwareInstallationId)
        .query(`
          DELETE FROM TICKET_SOFTWARE
          WHERE ticket_id = @ticketId AND software_installation_id = @installationId
        `);

      return result.rowsAffected[0] > 0;
    } catch (error) {
      console.error('Error unlinking software from ticket:', error);
      throw error;
    }
  }

  /**
   * Get count of assets linked to a ticket
   */
  static async getTicketAssetCount(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`
          SELECT COUNT(*) AS count
          FROM TICKET_ASSETS
          WHERE ticket_id = @ticketId
        `);

      return result.recordset[0].count;
    } catch (error) {
      console.error('Error getting ticket asset count:', error);
      throw error;
    }
  }

  /**
   * Sync ticket assets - adds new, removes unselected
   * @param {string} ticketId - Ticket ID
   * @param {Array} newAssetIds - Array of asset IDs that should be linked
   * @param {string} updatedBy - User ID making the change
   * @returns {Object} - { added: number, removed: number }
   */
  static async syncTicketAssets(ticketId, newAssetIds, updatedBy) {
    try {
      const pool = await connectDB();

      // Get current linked assets
      const currentResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`SELECT asset_id FROM TICKET_ASSETS WHERE ticket_id = @ticketId`);

      const currentAssetIds = currentResult.recordset.map(r => r.asset_id);

      // Determine assets to add and remove
      const toAdd = newAssetIds.filter(id => !currentAssetIds.includes(id));
      const toRemove = currentAssetIds.filter(id => !newAssetIds.includes(id));

      let addedCount = 0;
      let removedCount = 0;

      // Remove assets that are no longer selected
      if (toRemove.length > 0) {
        for (const assetId of toRemove) {
          await pool.request()
            .input('ticketId', sql.UniqueIdentifier, ticketId)
            .input('assetId', sql.UniqueIdentifier, assetId)
            .query(`DELETE FROM TICKET_ASSETS WHERE ticket_id = @ticketId AND asset_id = @assetId`);
          removedCount++;
        }
      }

      // Add newly selected assets
      if (toAdd.length > 0) {
        const results = await this.linkMultipleAssets(ticketId, toAdd, updatedBy);
        addedCount = results.length;
      }

      return { added: addedCount, removed: removedCount };
    } catch (error) {
      console.error('Error syncing ticket assets:', error);
      throw error;
    }
  }

  /**
   * Sync ticket software - adds new, removes unselected
   * @param {string} ticketId - Ticket ID
   * @param {Array} newSoftwareIds - Array of software installation IDs that should be linked
   * @param {string} updatedBy - User ID making the change
   * @returns {Object} - { added: number, removed: number }
   */
  static async syncTicketSoftware(ticketId, newSoftwareIds, updatedBy) {
    try {
      const pool = await connectDB();

      // Get current linked software
      const currentResult = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`SELECT software_installation_id FROM TICKET_SOFTWARE WHERE ticket_id = @ticketId`);

      const currentSoftwareIds = currentResult.recordset.map(r => r.software_installation_id);

      // Determine software to add and remove
      const toAdd = newSoftwareIds.filter(id => !currentSoftwareIds.includes(id));
      const toRemove = currentSoftwareIds.filter(id => !newSoftwareIds.includes(id));

      let addedCount = 0;
      let removedCount = 0;

      // Remove software that is no longer selected
      if (toRemove.length > 0) {
        for (const installationId of toRemove) {
          await pool.request()
            .input('ticketId', sql.UniqueIdentifier, ticketId)
            .input('installationId', sql.UniqueIdentifier, installationId)
            .query(`DELETE FROM TICKET_SOFTWARE WHERE ticket_id = @ticketId AND software_installation_id = @installationId`);
          removedCount++;
        }
      }

      // Add newly selected software
      if (toAdd.length > 0) {
        const results = await this.linkMultipleSoftware(ticketId, toAdd, updatedBy);
        addedCount = results.length;
      }

      return { added: addedCount, removed: removedCount };
    } catch (error) {
      console.error('Error syncing ticket software:', error);
      throw error;
    }
  }

  /**
   * Clear all assets from a ticket
   * Used when category changes from Hardware to something else
   */
  static async clearTicketAssets(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`DELETE FROM TICKET_ASSETS WHERE ticket_id = @ticketId`);

      return result.rowsAffected[0];
    } catch (error) {
      console.error('Error clearing ticket assets:', error);
      throw error;
    }
  }

  /**
   * Clear all software from a ticket
   * Used when category changes from Software to something else
   */
  static async clearTicketSoftware(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`DELETE FROM TICKET_SOFTWARE WHERE ticket_id = @ticketId`);

      return result.rowsAffected[0];
    } catch (error) {
      console.error('Error clearing ticket software:', error);
      throw error;
    }
  }

  /**
   * Get current asset IDs linked to a ticket
   */
  static async getTicketAssetIds(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`SELECT asset_id FROM TICKET_ASSETS WHERE ticket_id = @ticketId`);

      return result.recordset.map(r => r.asset_id);
    } catch (error) {
      console.error('Error getting ticket asset IDs:', error);
      throw error;
    }
  }

  /**
   * Get current software installation IDs linked to a ticket
   */
  static async getTicketSoftwareIds(ticketId) {
    try {
      const pool = await connectDB();

      const result = await pool.request()
        .input('ticketId', sql.UniqueIdentifier, ticketId)
        .query(`SELECT software_installation_id FROM TICKET_SOFTWARE WHERE ticket_id = @ticketId`);

      return result.recordset.map(r => r.software_installation_id);
    } catch (error) {
      console.error('Error getting ticket software IDs:', error);
      throw error;
    }
  }
}

module.exports = TicketAssetsModel;
