const AppError = require('../utils/AppError');
const { TemplateRepository } = require('../repositories');

const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Reply templates (canned messages). Owns the CRUD rules (at most one
 * default) and variable rendering so operators can personalize a quick
 * reply without leaving WhatsApp.
 */
class TemplateService {
  constructor({ templateRepo = new TemplateRepository() } = {}) {
    this.templateRepo = templateRepo;
  }

  async create(data) {
    if (data.isDefault) await this.templateRepo.clearDefault();
    return this.templateRepo.create(data);
  }

  async get(id) {
    const template = await this.templateRepo.findById(id);
    if (!template) throw new AppError('Template not found', 404, null, 'TEMPLATE_NOT_FOUND');
    return template;
  }

  async list(query = {}) {
    return this.templateRepo.list({
      isActive: query.isActive === undefined ? null : query.isActive,
      category: query.category || null,
      search: query.search || null,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /** The active default template, if any (auto-reply fallback). */
  async findDefault() {
    return this.templateRepo.findDefault();
  }

  async update(id, data) {
    const existing = await this.templateRepo.findById(id);
    if (!existing) throw new AppError('Template not found', 404, null, 'TEMPLATE_NOT_FOUND');
    if (data.isDefault) await this.templateRepo.clearDefault();
    return this.templateRepo.update(id, data);
  }

  async delete(id) {
    const existing = await this.templateRepo.findById(id);
    if (!existing) throw new AppError('Template not found', 404, null, 'TEMPLATE_NOT_FOUND');
    await this.templateRepo.delete(id);
    return true;
  }

  /**
   * Substitutes {{variable}} placeholders. Unknown variables become an
   * empty string; callers pass contact-derived values (name, phone...).
   */
  render(body, vars = {}) {
    return String(body).replace(VARIABLE_RE, (match, key) => {
      const value = vars[key];
      return value === null || value === undefined ? '' : String(value);
    });
  }

  async incrementUsage(id) {
    await this.templateRepo.incrementUsage(id);
  }
}

module.exports = { TemplateService, VARIABLE_RE };
