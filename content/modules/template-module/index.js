/**
 * Шаблон для создания нового модуля
 * Скопируйте эту папку, переименуйте и зарегистрируйте в content/content-main.js!
 */
import { domObserver } from '../../core/dom-observer.js';
import { StorageService } from '../../core/storage.js';
import { eventBus } from '../../core/event-bus.js';

export class TemplateCustomModule {
  constructor() {
    // 1. Уникальный ID модуля (английские буквы и дефис)
    this.id = 'template-module';
    // 2. Название, отображаемое в настройках
    this.name = 'Пользовательский шаблонный модуль';
    // 3. Описание
    this.description = 'Пример модуля для добавления ваших собственных функций в расширение.';

    this.unwatchers = [];
  }

  /**
   * Вызывается один раз при загрузке страницы / расширения
   */
  async init() {
    console.log(`[Module ${this.id}] Инициализация...`);
    // Здесь можно загрузить персональные настройки модуля из хранилища:
    // const settings = await StorageService.get('my-custom-setting');
  }

  /**
   * Вызывается, когда модуль включен (активен)
   */
  enable() {
    console.log(`[Module ${this.id}] Включен!`);

    // Пример 1: Отслеживание появления элементов на странице dat.one
    const unwatch = domObserver.watch('.some-dat-element', (el) => {
      // Ваши действия с элементом на странице
      // el.style.border = '2px solid green';
    });
    this.unwatchers.push(unwatch);

    // Пример 2: Подписка на события других модулей (например, обновление заметок)
    // eventBus.on('notes:updated', (note) => { ... });
  }

  /**
   * Вызывается, когда модуль выключен пользователем
   * Обязательно очищайте добавленные стили, кнопки и наблюдатели!
   */
  disable() {
    console.log(`[Module ${this.id}] Выключен!`);

    // Отключаем наблюдатели
    this.unwatchers.forEach((unwatch) => unwatch());
    this.unwatchers = [];

    // Удаляем созданные элементы из DOM, если они были добавлены
  }
}

export const templateCustomModule = new TemplateCustomModule();
