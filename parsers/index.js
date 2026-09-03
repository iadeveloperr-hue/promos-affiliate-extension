(function () {
  'use strict';
  window.PromosParser = window.PromosParser || {};

  window.PromosParser.parse = function parse() {
    const host = location.hostname;
    if (host.includes('amazon'))       return window.PromosParser.amazon();
    if (host.includes('mercadolivre')) return window.PromosParser.mercadolivre();
    if (host.includes('shopee'))       return window.PromosParser.shopee();
    return null;
  };
})();
