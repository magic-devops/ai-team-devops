/** The development lifecycle has one authoritative workbench. */
function DevFlowHub() {
  const target = '/#/dev-flow?view=overview';
  React.useEffect(function () {
    window.location.replace(target);
  }, []);
  const label = typeof window.t === 'function' ? window.t('page_dev_flow') : '研发全流程';
  return React.createElement('a', { href: target }, label);
}
