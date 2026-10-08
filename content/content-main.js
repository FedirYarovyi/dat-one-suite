/**
 * Content Script Main Entry Point
 * Orchestrates modules, DOM observers, and lifecycle management.
 */
import { domObserver } from './core/dom-observer.js';
import { moduleManager } from './core/module-manager.js';
import { sidebarToggleModule } from './modules/sidebar-toggle/index.js';
import { companyNotesModule } from './modules/company-notes/index.js';

// If you create new modules, simply import them here and register below!
// import { templateCustomModule } from './modules/template-module/index.js';

async function bootstrap() {
  console.log('[DAT One Suite] Инициализация расширения...');

  // Start DOM and SPA navigation observer
  domObserver.start();

  // 1. Регистрация модуля скрытия боковой панели
  moduleManager.register(sidebarToggleModule);

  // 2. Регистрация модуля заметок о компаниях
  moduleManager.register(companyNotesModule);

  // 3. Запуск всех зарегистрированных модулей
  await moduleManager.startAll();

  console.log('[DAT One Suite] Все модули успешно запущены:', moduleManager.getModules());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
