const { z } = require('zod');

/**
 * Zod schema for the payload Bitrix24 POSTs to the message provider
 * HANDLER (POST /api/bitrix24/sms) when a user or automation rule sends
 * a message through the registered provider.
 *
 * Documented fields:
 *   module_id   - "crm" (CRM card) or "bizproc" (Workflow / automation rule)
 *   bindings    - CRM object links (provided when module_id=crm)
 *   workflow_id, document_id, document_type - workflow data (bizproc)
 *   properties  - { phone_number, message_text } (crm convenience fields)
 *   type        - "SMS"
 *   code        - provider code (wa_b24_sms_<member_id>)
 *   message_id  - Bitrix24 external message id; kept for status updates
 *   message_to  - recipient phone number
 *   message_body- message text
 *   ts          - unix timestamp (seconds)
 *
 * Unknown keys are allowed (passthrough) so the payload is stored whole.
 */

const b24BindingSchema = z
  .object({
    OWNER_TYPE_ID: z.union([z.number(), z.string()]).optional(),
    OWNER_ID: z.union([z.number(), z.string()]).optional(),
    ENTITY_TYPE: z.string().optional(),
    ENTITY_ID: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const bitrix24SmsSchema = z
  .object({
    module_id: z.string().max(50).optional(),
    type: z.string().max(50).optional(),
    code: z.string().min(1).max(100),
    message_id: z.string().min(1).max(255),
    message_to: z.string().min(3).max(50),
    message_body: z.string().min(1).max(5000),
    properties: z.record(z.unknown()).optional(),
    bindings: z.array(b24BindingSchema).optional(),
    workflow_id: z.union([z.number(), z.string()]).optional(),
    document_id: z.union([z.number(), z.string()]).optional(),
    document_type: z.string().optional(),
    ts: z.union([z.number(), z.string()]).optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

module.exports = { bitrix24SmsSchema, b24BindingSchema };
