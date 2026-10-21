/** Design originals have one authoritative project-scoped workbench. */
function DesignDocsManager() {
  var params = new URLSearchParams();
  try {
    var projectId = localStorage.getItem('sop-current-project-id');
    if (projectId) params.set('project_id', projectId);
  } catch (_error) { /* The canonical page will request a project. */ }
  var target = '/#/intelligence/design-docs' + (params.toString() ? '?' + params : '');
  React.useEffect(function () { window.location.replace(target); }, [target]);
  var label = typeof window.t === 'function' ? window.t('page_design_docs') : '设计资料库';
  return React.createElement('a', { href: target }, label);
}
window.DesignDocsManager = DesignDocsManager;
