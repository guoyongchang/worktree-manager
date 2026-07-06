/* @ds-bundle: {"format":4,"namespace":"WorktreeManagerDesignSystem_e60f48","components":[{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"CardHeader","sourcePath":"components/display/Card.jsx"},{"name":"CardTitle","sourcePath":"components/display/Card.jsx"},{"name":"CardDescription","sourcePath":"components/display/Card.jsx"},{"name":"CardContent","sourcePath":"components/display/Card.jsx"},{"name":"CardFooter","sourcePath":"components/display/Card.jsx"},{"name":"StatusDot","sourcePath":"components/display/StatusDot.jsx"},{"name":"TOAST_DURATION","sourcePath":"components/feedback/Toast.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"ToastStack","sourcePath":"components/feedback/Toast.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Icon","sourcePath":"components/icons/Icon.jsx"},{"name":"Dialog","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogHeader","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogFooter","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogTitle","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DialogDescription","sourcePath":"components/overlays/Dialog.jsx"},{"name":"DropdownMenu","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"DropdownMenuItem","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"DropdownMenuLabel","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"DropdownMenuSeparator","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"DropdownMenuShortcut","sourcePath":"components/overlays/DropdownMenu.jsx"},{"name":"Popover","sourcePath":"components/overlays/Popover.jsx"},{"name":"Tooltip","sourcePath":"components/overlays/Tooltip.jsx"}],"sourceHashes":{"components/display/Badge.jsx":"a64900a98ca4","components/display/Card.jsx":"acfe6744ebb2","components/display/StatusDot.jsx":"4af07815c458","components/feedback/Toast.jsx":"419d47245696","components/forms/Button.jsx":"bed108c639a7","components/forms/Checkbox.jsx":"74520d84c6cc","components/forms/Input.jsx":"a141bc188ba2","components/forms/Select.jsx":"d6359c12a4d9","components/icons/Icon.jsx":"2aa9918182fa","components/overlays/Dialog.jsx":"0874ae1e227f","components/overlays/DropdownMenu.jsx":"9fdea67725f9","components/overlays/Popover.jsx":"6bd96853712f","components/overlays/Tooltip.jsx":"23edf4673821","ui_kits/worktree-manager/CreateWorktreeModal.jsx":"06aeff81d68f","ui_kits/worktree-manager/DetailView.jsx":"c2957e47106e","ui_kits/worktree-manager/ProjectCard.jsx":"9f8ef34c709c","ui_kits/worktree-manager/Sidebar.jsx":"a77341d8fc6d","ui_kits/worktree-manager/TerminalPanel.jsx":"566cee0563f7","ui_kits/worktree-manager/app.jsx":"33220a54d117","ui_kits/worktree-manager/data.js":"28002abd91ac"},"inlinedExternals":[],"unexposedExports":[{"name":"wmEnsureStyle","sourcePath":"components/forms/Button.jsx"}]} */

(() => {

const __ds_ns = (window.WorktreeManagerDesignSystem_e60f48 = window.WorktreeManagerDesignSystem_e60f48 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/StatusDot.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const DOT_COLORS = {
  success: '#10B981',
  /* emerald-500 */
  warning: '#F59E0B',
  /* amber-500 */
  info: 'var(--accent)',
  sync: '#A855F7' /* purple-500 */
};

/** Port of StatusDot from src/components/Icons.tsx — 10px solid circle. */
function StatusDot({
  status = 'info',
  style,
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-block',
      width: 10,
      height: 10,
      borderRadius: 9999,
      background: DOT_COLORS[status] || DOT_COLORS.info,
      flexShrink: 0,
      ...style
    }
  }, props));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Injects component CSS once per page */
function wmEnsureStyle(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}
wmEnsureStyle('wm-style-button', `
.wm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  white-space: nowrap; border-radius: var(--radius-md, 6px);
  font-size: 14px; font-weight: 500; font-family: var(--font-ui);
  transition: all 150ms; cursor: pointer; border: 1px solid transparent;
  -webkit-user-select: none; user-select: none;
}
.wm-btn:focus-visible { box-shadow: var(--focus-ring); }
.wm-btn:disabled { pointer-events: none; opacity: 0.5; }
.wm-btn svg { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
.wm-btn--size-default { height: 36px; padding: 8px 16px; }
.wm-btn--size-sm { height: 32px; padding: 0 12px; font-size: 12px; }
.wm-btn--size-lg { height: 40px; padding: 0 32px; }
.wm-btn--size-icon { height: 36px; width: 36px; padding: 0; }
.wm-btn--default { background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--default:hover { background: var(--accent-hover); }
.wm-btn--destructive { background: var(--error); color: var(--error-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--destructive:hover { background: var(--error-light); }
.wm-btn--warning { background: var(--warning); color: var(--warning-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--warning:hover { background: var(--warning-light); }
.wm-btn--outline { border-color: var(--border); background: transparent; color: var(--text-primary); box-shadow: var(--shadow-subtle); }
.wm-btn--outline:hover { background: var(--bg-elevated); }
.wm-btn--secondary { background: var(--bg-surface); color: var(--text-primary); border-color: var(--border); box-shadow: var(--shadow-subtle); }
.wm-btn--secondary:hover { background: var(--bg-elevated); }
.wm-btn--ghost { background: transparent; color: var(--text-primary); }
.wm-btn--ghost:hover { background: var(--bg-surface); }
.wm-btn--link { background: transparent; color: var(--accent); text-underline-offset: 4px; }
.wm-btn--link:hover { text-decoration: underline; }
`);
function Button({
  variant = 'default',
  size = 'default',
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `wm-btn wm-btn--${variant} wm-btn--size-${size} ${className}`
  }, props), children);
}
Object.assign(__ds_scope, { wmEnsureStyle, Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
__ds_scope.wmEnsureStyle('wm-style-badge', `
.wm-badge {
  display: inline-flex; align-items: center; border-radius: var(--radius-full, 9999px);
  border: 1px solid transparent; padding: 2px 8px; font-size: 10px; font-weight: 500;
  font-family: var(--font-ui); transition: color 150ms, background 150ms; line-height: 1.5;
  white-space: nowrap;
}
.wm-badge--default { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent-hover); }
.wm-badge--secondary { background: var(--bg-elevated); color: var(--text-secondary); }
.wm-badge--success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success-light); }
.wm-badge--warning { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning-light); }
.wm-badge--destructive { background: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error-light); }
.wm-badge--outline { border-color: var(--border); color: var(--text-secondary); }
`);
function Badge({
  variant = 'default',
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-badge wm-badge--${variant} ${className}`
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
__ds_scope.wmEnsureStyle('wm-style-card', `
.wm-card {
  border-radius: var(--radius-lg, 8px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary);
  box-shadow: var(--shadow-subtle); font-family: var(--font-ui);
}
.wm-card-header { display: flex; flex-direction: column; gap: 6px; padding: 24px; }
.wm-card-title { font-weight: 600; line-height: 1; letter-spacing: -0.025em; }
.wm-card-description { font-size: 14px; color: var(--text-secondary); }
.wm-card-content { padding: 24px; padding-top: 0; }
.wm-card-footer { display: flex; align-items: center; padding: 24px; padding-top: 0; }
`);
function Card({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card ${className}`
  }, props), children);
}
function CardHeader({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card-header ${className}`
  }, props), children);
}
function CardTitle({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card-title ${className}`
  }, props), children);
}
function CardDescription({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card-description ${className}`
  }, props), children);
}
function CardContent({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card-content ${className}`
  }, props), children);
}
function CardFooter({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-card-footer ${className}`
  }, props), children);
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useEffect
} = React;
__ds_scope.wmEnsureStyle('wm-style-toast', `
.wm-toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
.wm-toast {
  position: relative; display: flex; align-items: stretch; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius-lg, 8px);
  background: var(--bg-surface); box-shadow: var(--shadow-lg); max-width: 384px;
  animation: slide-in-from-bottom-4 0.3s ease-out; font-family: var(--font-ui);
}
.wm-toast--exiting { animation: slide-out-to-right 0.2s ease-in forwards; }
.wm-toast-bar { width: 2px; flex-shrink: 0; }
.wm-toast-body { display: flex; align-items: flex-start; gap: 10px; padding: 12px; flex: 1; }
.wm-toast-icon { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }
.wm-toast-message { font-size: 14px; color: var(--text-primary); flex: 1; word-break: break-word; margin: 0; }
.wm-toast-close {
  flex-shrink: 0; background: none; border: none; padding: 0; cursor: pointer;
  color: var(--text-muted); transition: color 150ms; line-height: 0;
}
.wm-toast-close:hover { color: var(--text-primary); }
.wm-toast-close svg { width: 14px; height: 14px; }
.wm-toast-countdown { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; }
.wm-toast-countdown > div { height: 100%; opacity: 0.4; }
`);
const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'wm-toast-icon'
};
const ICONS = {
  success: /*#__PURE__*/React.createElement("svg", svgProps, /*#__PURE__*/React.createElement("path", {
    d: "M22 11.08V12a10 10 0 1 1-5.93-9.14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 11 3 3L22 4"
  })),
  error: /*#__PURE__*/React.createElement("svg", svgProps, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m15 9-6 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 9 6 6"
  })),
  info: /*#__PURE__*/React.createElement("svg", svgProps, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 16v-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 8h.01"
  })),
  warning: /*#__PURE__*/React.createElement("svg", svgProps, /*#__PURE__*/React.createElement("path", {
    d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 17h.01"
  }))
};
const BAR_COLOR = {
  success: 'var(--success)',
  error: 'var(--error)',
  info: 'var(--accent)',
  warning: 'var(--warning)'
};

/* Auto-dismiss durations per type, ms; 0 = persistent (error) — from src/components/Toast.tsx */
const TOAST_DURATION = {
  success: 3000,
  error: 0,
  info: 3000,
  warning: 5000
};
function Toast({
  type = 'info',
  message,
  onClose,
  duration,
  exiting = false
}) {
  const ms = duration !== undefined ? duration : TOAST_DURATION[type];
  useEffect(() => {
    if (!ms || !onClose) return;
    const timer = setTimeout(onClose, ms);
    return () => clearTimeout(timer);
  }, [ms, onClose]);
  const color = BAR_COLOR[type] || BAR_COLOR.info;
  return /*#__PURE__*/React.createElement("div", {
    className: `wm-toast ${exiting ? 'wm-toast--exiting' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "wm-toast-bar",
    style: {
      background: color
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "wm-toast-body"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color,
      lineHeight: 0
    }
  }, ICONS[type] || ICONS.info), /*#__PURE__*/React.createElement("p", {
    className: "wm-toast-message"
  }, message), onClose && /*#__PURE__*/React.createElement("button", {
    className: "wm-toast-close",
    onClick: onClose,
    "aria-label": "Dismiss"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m6 6 12 12"
  })))), ms > 0 && /*#__PURE__*/React.createElement("div", {
    className: "wm-toast-countdown"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: color,
      animation: `toast-countdown ${ms}ms linear forwards`
    }
  })));
}
function ToastStack({
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "wm-toast-stack"
  }, props), children);
}
Object.assign(__ds_scope, { TOAST_DURATION, Toast, ToastStack });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
__ds_scope.wmEnsureStyle('wm-style-checkbox', `
.wm-checkbox {
  width: 16px; height: 16px; flex-shrink: 0;
  border-radius: var(--radius, 4px); border: 1px solid var(--border);
  background: var(--bg-surface); accent-color: var(--accent);
  cursor: pointer; margin: 0;
}
.wm-checkbox:focus-visible { box-shadow: var(--focus-ring); }
.wm-checkbox:disabled { cursor: not-allowed; opacity: 0.5; }
.wm-checkbox-label {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font-size: 14px; color: var(--text-primary); font-family: var(--font-ui);
}
`);
function Checkbox({
  className = '',
  label,
  ...props
}) {
  const box = /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    className: `wm-checkbox ${className}`
  }, props));
  if (!label) return box;
  return /*#__PURE__*/React.createElement("label", {
    className: "wm-checkbox-label"
  }, box, /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
__ds_scope.wmEnsureStyle('wm-style-input', `
.wm-input {
  display: flex; height: 36px; width: 100%;
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); padding: 4px 12px;
  font-size: 14px; font-family: var(--font-ui); color: var(--text-primary);
  box-shadow: var(--shadow-subtle); transition: border-color 150ms, box-shadow 150ms;
}
.wm-input::placeholder { color: var(--text-muted); }
.wm-input:focus { box-shadow: var(--focus-ring); }
.wm-input:disabled { cursor: not-allowed; opacity: 0.5; }
`);
function Input({
  className = '',
  ...props
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    className: `wm-input ${className}`
  }, props));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
const {
  useState,
  useRef,
  useEffect
} = React;
__ds_scope.wmEnsureStyle('wm-style-select', `
.wm-select { position: relative; display: inline-block; width: 100%; font-family: var(--font-ui); }
.wm-select-trigger {
  display: flex; height: 36px; width: 100%; align-items: center; justify-content: space-between;
  white-space: nowrap; border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); padding: 8px 12px; font-size: 14px; color: var(--text-primary);
  box-shadow: var(--shadow-subtle); cursor: pointer; transition: box-shadow 150ms;
}
.wm-select-trigger:focus { box-shadow: var(--focus-ring); }
.wm-select-trigger:disabled { cursor: not-allowed; opacity: 0.5; }
.wm-select-trigger .wm-select-placeholder { color: var(--text-muted); }
.wm-select-trigger svg { width: 16px; height: 16px; opacity: 0.5; flex-shrink: 0; margin-left: 8px; }
.wm-select-content {
  position: absolute; z-index: 50; top: calc(100% + 4px); left: 0; min-width: 8rem; width: 100%;
  max-height: 384px; overflow-y: auto; border-radius: var(--radius-md, 6px);
  border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary);
  box-shadow: var(--shadow-lg); padding: 4px; animation: animate-in 0.15s ease-out;
}
.wm-select-item {
  position: relative; display: flex; width: 100%; align-items: center; cursor: default;
  -webkit-user-select: none; user-select: none; border-radius: var(--radius-sm, 2px);
  padding: 6px 32px 6px 8px; font-size: 14px; color: var(--text-primary); border: none;
  background: transparent; text-align: left;
}
.wm-select-item:hover { background: var(--bg-elevated); }
.wm-select-item .wm-select-check {
  position: absolute; right: 8px; display: flex; width: 14px; height: 14px;
  align-items: center; justify-content: center;
}
.wm-select-item .wm-select-check svg { width: 16px; height: 16px; }
`);
const ChevronDownSvg = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "m6 9 6 6 6-6"
}));
const CheckSvg = () => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "2",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: "M20 6 9 17l-5-5"
}));

/** Cosmetic port of the Radix-based select.tsx: trigger + floating item list with right-aligned check. */
function Select({
  options = [],
  value,
  defaultValue,
  onChange,
  placeholder = 'Select…',
  disabled,
  className = '',
  style
}) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = value !== undefined ? value : internal;
  const items = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  const selected = items.find(i => i.value === current);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    className: `wm-select ${className}`,
    style: style,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "wm-select-trigger",
    disabled: disabled,
    onClick: () => setOpen(o => !o)
  }, selected ? /*#__PURE__*/React.createElement("span", null, selected.label) : /*#__PURE__*/React.createElement("span", {
    className: "wm-select-placeholder"
  }, placeholder), /*#__PURE__*/React.createElement(ChevronDownSvg, null)), open && /*#__PURE__*/React.createElement("div", {
    className: "wm-select-content"
  }, items.map(item => /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: item.value,
    className: "wm-select-item",
    onClick: () => {
      setInternal(item.value);
      setOpen(false);
      if (onChange) onChange(item.value);
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "wm-select-check"
  }, item.value === current ? /*#__PURE__*/React.createElement(CheckSvg, null) : null), item.label))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/icons/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useEffect,
  useState
} = React;
const LUCIDE_CDN = 'https://unpkg.com/lucide@0.462.0/dist/umd/lucide.min.js';
let loadPromise = null;
function loadLucide() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.lucide) return Promise.resolve(window.lucide);
  if (!loadPromise) {
    loadPromise = new Promise(resolve => {
      const existing = document.getElementById('wm-lucide-script');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.lucide));
        return;
      }
      const s = document.createElement('script');
      s.id = 'wm-lucide-script';
      s.src = LUCIDE_CDN;
      s.onload = () => resolve(window.lucide);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}
function toPascal(name) {
  return name.split(/[-_\s]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
function renderNode(node, key) {
  // lucide IconNode entries: [tag, attrs] or [tag, attrs, children]
  const [tag, attrs, children] = node;
  const props = {
    key
  };
  for (const k in attrs) {
    if (k === 'key') continue;
    props[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k];
  }
  return React.createElement(tag, props, Array.isArray(children) ? children.map((c, i) => renderNode(c, i)) : undefined);
}

/**
 * Lucide icon (the app's icon set, loaded from CDN UMD build).
 * Renders 24-grid stroke icons: fill none, stroke currentColor, width 2, round caps.
 */
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  color = 'currentColor',
  className = '',
  style,
  ...props
}) {
  const [, force] = useState(0);
  const ready = typeof window !== 'undefined' && window.lucide;
  useEffect(() => {
    if (!ready) loadLucide().then(() => force(n => n + 1));
  }, [ready]);
  let node = null;
  if (ready && window.lucide.icons) {
    node = window.lucide.icons[toPascal(name)] || window.lucide.icons[name] || null;
  }
  return /*#__PURE__*/React.createElement("svg", _extends({
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: className,
    style: {
      flexShrink: 0,
      ...style
    }
  }, props), Array.isArray(node) ? node.map((n, i) => renderNode(n, i)) : null);
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icons/Icon.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useEffect
} = React;
__ds_scope.wmEnsureStyle('wm-style-dialog', `
.wm-dialog-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: var(--overlay, rgba(0,0,0,0.6));
  -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px);
  animation: fade-in 0.15s ease-out;
}
.wm-dialog-content {
  position: fixed; left: 50%; top: 50%; z-index: 50; transform: translate(-50%, -50%);
  display: grid; gap: 16px; width: calc(100% - 32px); max-width: 512px;
  border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary);
  padding: 24px; box-shadow: var(--shadow-modal); border-radius: var(--radius-lg, 8px);
  animation: animate-in 0.15s ease-out; font-family: var(--font-ui);
}
.wm-dialog-close {
  position: absolute; right: 16px; top: 16px; border-radius: var(--radius-sm, 2px);
  opacity: 0.7; background: transparent; border: none; cursor: pointer; padding: 0;
  color: var(--text-secondary); transition: opacity 150ms; line-height: 0;
}
.wm-dialog-close:hover { opacity: 1; }
.wm-dialog-close svg { width: 16px; height: 16px; }
.wm-dialog-header { display: flex; flex-direction: column; gap: 6px; text-align: left; }
.wm-dialog-footer { display: flex; flex-direction: row; justify-content: flex-end; gap: 8px; }
.wm-dialog-title { font-size: 16px; font-weight: 500; line-height: 1; letter-spacing: -0.025em; color: var(--text-primary); }
.wm-dialog-description { font-size: 14px; color: var(--text-secondary); }
`);
function Dialog({
  open,
  onOpenChange,
  maxWidth,
  className = '',
  children
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => {
      if (e.key === 'Escape' && onOpenChange) onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "wm-dialog-overlay",
    onClick: () => onOpenChange && onOpenChange(false)
  }), /*#__PURE__*/React.createElement("div", {
    className: `wm-dialog-content ${className}`,
    style: maxWidth ? {
      maxWidth
    } : undefined,
    role: "dialog"
  }, children, /*#__PURE__*/React.createElement("button", {
    className: "wm-dialog-close",
    onClick: () => onOpenChange && onOpenChange(false),
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m6 6 12 12"
  })))));
}
function DialogHeader({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-dialog-header ${className}`
  }, props), children);
}
function DialogFooter({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-dialog-footer ${className}`
  }, props), children);
}
function DialogTitle({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-dialog-title ${className}`
  }, props), children);
}
function DialogDescription({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-dialog-description ${className}`
  }, props), children);
}
Object.assign(__ds_scope, { Dialog, DialogHeader, DialogFooter, DialogTitle, DialogDescription });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/DropdownMenu.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState,
  useRef,
  useEffect
} = React;
__ds_scope.wmEnsureStyle('wm-style-dropdown', `
.wm-menu-root { position: relative; display: inline-block; }
.wm-menu-content {
  position: absolute; z-index: 50; min-width: 8rem; overflow: hidden;
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary); padding: 4px;
  box-shadow: var(--shadow-lg); animation: animate-in 0.15s ease-out;
  top: calc(100% + 4px); font-family: var(--font-ui);
}
.wm-menu-content--start { left: 0; }
.wm-menu-content--end { right: 0; }
.wm-menu-item {
  position: relative; display: flex; width: 100%; cursor: default; align-items: center; gap: 8px;
  border-radius: var(--radius-sm, 2px); padding: 6px 8px; font-size: 14px; border: none;
  background: transparent; color: var(--text-primary); text-align: left;
  transition: background 150ms, color 150ms;
}
.wm-menu-item:hover:not(:disabled) { background: var(--bg-elevated); }
.wm-menu-item:disabled { pointer-events: none; opacity: 0.5; }
.wm-menu-item--destructive { color: var(--error); }
.wm-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
.wm-menu-label { padding: 6px 8px; font-size: 14px; font-weight: 500; color: var(--text-secondary); }
.wm-menu-separator { margin: 4px -4px; height: 1px; background: var(--border); }
.wm-menu-shortcut { margin-left: auto; font-size: 12px; letter-spacing: 0.1em; opacity: 0.6; }
`);
function DropdownMenu({
  trigger,
  align = 'start',
  width,
  children
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    className: "wm-menu-root",
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpen(o => !o),
    style: {
      display: 'contents'
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    className: `wm-menu-content wm-menu-content--${align}`,
    style: width ? {
      width
    } : undefined,
    onClick: () => setOpen(false)
  }, children));
}
function DropdownMenuItem({
  destructive,
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `wm-menu-item ${destructive ? 'wm-menu-item--destructive' : ''} ${className}`
  }, props), children);
}
function DropdownMenuLabel({
  className = '',
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `wm-menu-label ${className}`
  }, props), children);
}
function DropdownMenuSeparator(props) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "wm-menu-separator"
  }, props));
}
function DropdownMenuShortcut({
  children,
  ...props
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: "wm-menu-shortcut"
  }, props), children);
}
Object.assign(__ds_scope, { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/DropdownMenu.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Popover.jsx
try { (() => {
const {
  useState,
  useRef,
  useEffect
} = React;
__ds_scope.wmEnsureStyle('wm-style-popover', `
.wm-popover-root { position: relative; display: inline-block; }
.wm-popover-content {
  position: absolute; z-index: 50; top: calc(100% + 4px);
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary); padding: 16px;
  box-shadow: var(--shadow-lg); animation: animate-in 0.15s ease-out;
  font-family: var(--font-ui); width: max-content; max-width: 320px;
}
.wm-popover-content--start { left: 0; }
.wm-popover-content--center { left: 50%; transform: translateX(-50%); }
.wm-popover-content--end { right: 0; }
`);
function Popover({
  trigger,
  align = 'center',
  className = '',
  children
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return /*#__PURE__*/React.createElement("div", {
    className: "wm-popover-root",
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => setOpen(o => !o),
    style: {
      display: 'contents'
    }
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    className: `wm-popover-content wm-popover-content--${align} ${className}`
  }, children));
}
Object.assign(__ds_scope, { Popover });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Popover.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Tooltip.jsx
try { (() => {
__ds_scope.wmEnsureStyle('wm-style-tooltip', `
.wm-tooltip-wrap { position: relative; display: inline-flex; }
.wm-tooltip {
  position: absolute; z-index: 50; display: none; overflow: hidden; white-space: nowrap;
  border-radius: var(--radius-md, 6px); background: var(--bg-elevated);
  border: 1px solid var(--border); padding: 6px 12px; font-size: 12px;
  color: var(--text-primary); box-shadow: var(--shadow-lg); font-family: var(--font-ui);
  pointer-events: none;
}
.wm-tooltip-wrap:hover .wm-tooltip { display: block; animation: animate-in 0.15s ease-out; }
.wm-tooltip--top { bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.wm-tooltip--bottom { top: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.wm-tooltip--left { right: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
.wm-tooltip--right { left: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
`);
function Tooltip({
  content,
  side = 'top',
  className = '',
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `wm-tooltip-wrap ${className}`
  }, children, /*#__PURE__*/React.createElement("span", {
    className: `wm-tooltip wm-tooltip--${side}`,
    role: "tooltip"
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Tooltip.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/CreateWorktreeModal.jsx
try { (() => {
/* CreateWorktreeModal — port of src/components/CreateWorktreeModal.tsx (per docs/screenshots/new-worktree.png) */
const {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Checkbox,
  Select,
  StatusDot,
  Icon
} = window.WorktreeManagerDesignSystem_e60f48;
function CreateWorktreeModal({
  open,
  onOpenChange,
  data,
  onCreate
}) {
  const [name, setName] = React.useState('');
  const [tab, setTab] = React.useState('all');
  const [selected, setSelected] = React.useState(() => data.defaultProjects.map(p => p.name));
  const [sync, setSync] = React.useState(true);
  const toggle = n => setSelected(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]);
  const reset = () => {
    setName('');
    setSelected(data.defaultProjects.map(p => p.name));
  };
  const projectRow = p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    className: "wmk-cm-project"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: selected.includes(p.name),
    onChange: () => toggle(p.name)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500,
      color: 'var(--text-primary)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, "default: main \xB7 test: test"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-secondary)'
    }
  }, "Base:"), /*#__PURE__*/React.createElement(Select, {
    options: ['main', 'develop'],
    defaultValue: p.base,
    style: {
      width: 110
    }
  })));
  return /*#__PURE__*/React.createElement(Dialog, {
    open: open,
    onOpenChange: v => {
      onOpenChange(v);
      if (!v) reset();
    },
    maxWidth: "560px"
  }, /*#__PURE__*/React.createElement(DialogHeader, null, /*#__PURE__*/React.createElement(DialogTitle, null, "New Worktree")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, "Worktree name"), /*#__PURE__*/React.createElement(Input, {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "feature-login",
    autoFocus: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: 'var(--text-primary)'
    }
  }, "Select projects"), /*#__PURE__*/React.createElement("div", {
    className: "wmk-cm-tabs"
  }, /*#__PURE__*/React.createElement("button", {
    className: `wmk-cm-tab ${tab === 'all' ? 'wmk-cm-tab--active' : ''}`,
    onClick: () => setTab('all')
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: `wmk-cm-tab ${tab === 'tag' ? 'wmk-cm-tab--active' : ''}`,
    onClick: () => setTab('tag')
  }, "By tag")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxHeight: 300,
      overflowY: 'auto'
    }
  }, tab === 'tag' && /*#__PURE__*/React.createElement("div", {
    className: "wmk-cm-group"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-down",
    size: 14,
    style: {
      color: 'var(--text-muted)'
    }
  }), /*#__PURE__*/React.createElement(Checkbox, {
    checked: selected.length === 3,
    onChange: () => setSelected(selected.length === 3 ? [] : data.defaultProjects.map(p => p.name))
  }), /*#__PURE__*/React.createElement(StatusDot, {
    status: "success",
    style: {
      width: 8,
      height: 8
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 500
    }
  }, "Worktree"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, "(", selected.length, "/3)")), data.defaultProjects.map(projectRow))), /*#__PURE__*/React.createElement(DialogFooter, {
    style: {
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Sync Base before create",
    checked: sync,
    onChange: e => setSync(e.target.checked)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => {
      onOpenChange(false);
      reset();
    }
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    disabled: !name.trim() || selected.length === 0,
    onClick: () => {
      onCreate(name.trim(), selected);
      reset();
    }
  }, "Create (", selected.length, ")"))));
}
Object.assign(window, {
  CreateWorktreeModal
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/CreateWorktreeModal.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/DetailView.jsx
try { (() => {
/* DetailView — workspace overview + worktree detail; port of WorktreeDetail.tsx layouts */
const {
  Button,
  Badge,
  StatusDot,
  Tooltip,
  DropdownMenu,
  DropdownMenuItem,
  Icon
} = window.WorktreeManagerDesignSystem_e60f48;
function ToolbarIconGroup({
  onToast
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-icon-group"
  }, /*#__PURE__*/React.createElement(Tooltip, {
    content: "Sync all with main",
    side: "bottom"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-group-btn",
    onClick: () => onToast('success', 'All projects synced with main')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh-cw",
    size: 14
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Pull all",
    side: "bottom"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-group-btn",
    onClick: () => onToast('success', 'Pulled all projects')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 14
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Refresh",
    side: "bottom"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-group-btn",
    onClick: () => onToast('info', 'Remote state synced')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "rotate-cw",
    size: 14
  }))));
}
function SplitPicker({
  icon,
  accent,
  options,
  onToast,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `wmk-split ${accent ? 'wmk-split--accent' : ''}`
  }, /*#__PURE__*/React.createElement(Tooltip, {
    content: label,
    side: "bottom"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-split-main",
    onClick: () => onToast('success', `Opened in ${options[0]}`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 14
  }))), /*#__PURE__*/React.createElement(DropdownMenu, {
    align: "end",
    trigger: /*#__PURE__*/React.createElement("button", {
      className: "wmk-split-arrow"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-down",
      size: 13
    }))
  }, options.map(o => /*#__PURE__*/React.createElement(DropdownMenuItem, {
    key: o,
    onClick: () => onToast('success', `Opened in ${o}`)
  }, o))));
}
function VaultPanel({
  vault
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-vault"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-vault-head"
  }, /*#__PURE__*/React.createElement(StatusDot, {
    status: "success"
  }), /*#__PURE__*/React.createElement("span", null, vault.label), /*#__PURE__*/React.createElement("span", {
    className: "wmk-vault-count"
  }, "(", vault.count, ")")), /*#__PURE__*/React.createElement("div", {
    className: "wmk-chips"
  }, vault.items.map(it => /*#__PURE__*/React.createElement("span", {
    key: it.name,
    className: "wmk-chip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: it.type === 'folder' ? 'folder' : 'file',
    size: 12,
    style: {
      color: it.type === 'folder' ? 'var(--success-light)' : 'var(--text-muted)'
    }
  }), it.name))));
}
function GroupSection({
  group,
  onToast,
  children
}) {
  const [open, setOpen] = React.useState(group.expanded);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("button", {
    className: "wmk-group-head",
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 14,
    style: {
      transform: open ? 'rotate(90deg)' : 'none',
      transition: 'transform 150ms'
    }
  }), /*#__PURE__*/React.createElement(StatusDot, {
    status: group.dot,
    style: {
      width: 8,
      height: 8
    }
  }), /*#__PURE__*/React.createElement("span", null, group.name), /*#__PURE__*/React.createElement("span", {
    className: "wmk-vault-count"
  }, "(", group.count, ")")), open && children);
}
function WorkspaceOverview({
  data,
  actions
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-detail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "wmk-title"
  }, data.workspaceTitle), /*#__PURE__*/React.createElement("p", {
    className: "wmk-path"
  }, data.workspacePath)), /*#__PURE__*/React.createElement("div", {
    className: "wmk-toolbar"
  }, /*#__PURE__*/React.createElement(ToolbarIconGroup, {
    onToast: actions.toast
  }), /*#__PURE__*/React.createElement(Segmented, {
    options: ['BASE (5)', 'TEST', 'HEAD'],
    value: "BASE (5)"
  }), /*#__PURE__*/React.createElement(Button, {
    onClick: () => actions.toast('info', 'Add project — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), " Add Project"), /*#__PURE__*/React.createElement(SplitPicker, {
    icon: "code",
    accent: true,
    options: data.editors,
    onToast: actions.toast,
    label: "Open workspace in editor"
  }), /*#__PURE__*/React.createElement(SplitPicker, {
    icon: "terminal",
    options: data.terminals,
    onToast: actions.toast,
    label: "Open in terminal app"
  }))), /*#__PURE__*/React.createElement(VaultPanel, {
    vault: data.vault
  }), data.groups.map(group => /*#__PURE__*/React.createElement(GroupSection, {
    key: group.name,
    group: group,
    onToast: actions.toast
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-cards"
  }, group.projects.map(p => /*#__PURE__*/React.createElement(ProjectCard, {
    key: p.name,
    project: p,
    showSegmented: true,
    onToast: actions.toast
  }))))));
}
function WorktreeDetailView({
  wt,
  data,
  actions
}) {
  const projects = wt.projects || data.defaultProjects.map(p => ({
    name: p.name,
    branch: wt.name,
    badges: [{
      variant: 'success',
      label: 'Clean'
    }],
    stats: {
      ahead: 0,
      behind: 0,
      changed: 0
    },
    push: 'Push'
  }));
  const archived = actions.isArchived(wt.name);
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-detail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-detail-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "wmk-title",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: archived ? 'archive' : 'folder-open',
    size: 20,
    style: {
      color: 'var(--accent)'
    }
  }), wt.name), /*#__PURE__*/React.createElement("p", {
    className: "wmk-path"
  }, data.workspacePath, "/worktrees/", wt.name)), /*#__PURE__*/React.createElement("div", {
    className: "wmk-toolbar"
  }, !archived && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ToolbarIconGroup, {
    onToast: actions.toast
  }), /*#__PURE__*/React.createElement(SplitPicker, {
    icon: "code",
    accent: true,
    options: data.editors,
    onToast: actions.toast,
    label: "Open in editor"
  }), /*#__PURE__*/React.createElement(SplitPicker, {
    icon: "terminal",
    options: data.terminals,
    onToast: actions.toast,
    label: "Open in terminal app"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => actions.toast('info', 'Deploy to main workspace — not in this mock')
  }, "Deploy to main"), /*#__PURE__*/React.createElement(Button, {
    variant: "warning",
    onClick: () => actions.askArchive(wt.name)
  }, "Archive")), archived && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
    onClick: () => actions.restore(wt.name)
  }, "Restore"), /*#__PURE__*/React.createElement(Button, {
    variant: "destructive",
    onClick: () => actions.toast('error', 'Delete requires confirmation — not in this mock')
  }, "Delete")))), archived ? /*#__PURE__*/React.createElement("div", {
    className: "wmk-archived-note"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "archive",
    size: 16
  }), /*#__PURE__*/React.createElement("span", null, "This worktree is archived. Restore it to work on its branches again.")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "wmk-cards"
  }, projects.map(p => /*#__PURE__*/React.createElement(ProjectCard, {
    key: p.name,
    project: p,
    onToast: actions.toast
  }))), /*#__PURE__*/React.createElement("div", {
    className: "wmk-add-project",
    onClick: () => actions.toast('info', 'Add project to worktree — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, "Add project"))));
}
Object.assign(window, {
  WorkspaceOverview,
  WorktreeDetailView
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/DetailView.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/ProjectCard.jsx
try { (() => {
/* ProjectCard — port of the project card in WorktreeDetail.tsx + GitOperations.tsx */
const {
  Button,
  Badge,
  Tooltip,
  Icon
} = window.WorktreeManagerDesignSystem_e60f48;
function Segmented({
  options,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-segmented"
  }, options.map(o => /*#__PURE__*/React.createElement("button", {
    key: o,
    className: `wmk-segment ${o === value ? 'wmk-segment--active' : ''}`
  }, o)));
}
function CardIconRow({
  onToast,
  small
}) {
  const s = small ? 13 : 14;
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-icons"
  }, /*#__PURE__*/React.createElement(Tooltip, {
    content: "Project settings"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Project settings — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: s
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Reveal in Finder"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Revealed in Finder')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder",
    size: s
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Open in VS Code"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon wmk-mini-icon--accent",
    onClick: () => onToast('success', 'Opened in VS Code')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "code",
    size: s
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Open in terminal"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Terminal opened')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "terminal",
    size: s
  }))));
}
function ProjectCard({
  project,
  showSegmented,
  onToast
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `wmk-card ${project.uncommitted ? 'wmk-card--dirty' : ''}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "wmk-card-title"
  }, project.name), project.tag && /*#__PURE__*/React.createElement(Badge, {
    variant: "success"
  }, project.tag), project.tag2 && /*#__PURE__*/React.createElement(Badge, {
    style: {
      background: 'color-mix(in srgb, var(--wt-purple) 15%, transparent)',
      color: 'var(--wt-purple)'
    }
  }, project.tag2)), /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-branch"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "git-branch",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, project.branch))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(CardIconRow, {
    onToast: onToast,
    small: true
  }), showSegmented && /*#__PURE__*/React.createElement(Segmented, {
    options: ['BASE', 'TEST', 'HEAD'],
    value: "BASE"
  }))), project.badges && project.badges.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-badges"
  }, project.badges.map((b, i) => /*#__PURE__*/React.createElement(Badge, {
    key: i,
    variant: b.variant
  }, b.label))), /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-divider"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-stats"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, project.stats.ahead, " ahead"), /*#__PURE__*/React.createElement("span", null, project.stats.behind, " behind"), /*#__PURE__*/React.createElement("span", null, project.stats.changed, " changed file", project.stats.changed === 1 ? '' : 's')), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Refresh remote state"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', `Remote state synced for ${project.name}`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "rotate-cw",
    size: 13
  })))), /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      fontSize: 12,
      minWidth: 0
    },
    onClick: () => onToast('success', `Synced ${project.name} with main`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "refresh-cw",
    size: 12
  }), " Sync main"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      fontSize: 12,
      minWidth: 0
    },
    onClick: () => onToast('success', `Pulled ${project.branch}`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "download",
    size: 12
  }), " Pull"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      fontSize: 12,
      minWidth: 0
    },
    onClick: () => onToast('success', project.push === 'Commit & Push' ? 'Committed and pushed' : 'Pushed to remote')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 12
  }), " ", project.push)), /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-actions wmk-card-actions--2"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      fontSize: 12,
      minWidth: 0
    },
    onClick: () => onToast('success', `Merged ${project.branch} to test`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "git-merge",
    size: 12
  }), " Merge to test"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      fontSize: 12,
      minWidth: 0,
      borderColor: 'var(--merge-main-border)',
      color: 'var(--merge-main-text)'
    },
    onClick: () => onToast('warning', `Merge ${project.branch} to main requires confirmation`)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "git-merge",
    size: 12,
    color: "var(--merge-main-icon)"
  }), " Merge to main")), project.warning && /*#__PURE__*/React.createElement("div", {
    className: "wmk-card-warning"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "triangle-alert",
    size: 13,
    style: {
      color: 'var(--warning)'
    }
  }), /*#__PURE__*/React.createElement("span", null, project.warning)));
}
Object.assign(window, {
  ProjectCard,
  Segmented
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/ProjectCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/Sidebar.jsx
try { (() => {
/* Sidebar — port of src/components/worktree-sidebar/ExpandedSidebar.tsx */
const {
  Button,
  Input,
  Tooltip,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Icon,
  Badge
} = window.WorktreeManagerDesignSystem_e60f48;
function WorkspaceSwitcher({
  workspaces,
  current,
  onToast
}) {
  return /*#__PURE__*/React.createElement(DropdownMenu, {
    width: "230px",
    trigger: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      style: {
        flex: 1,
        justifyContent: 'space-between',
        minWidth: 0,
        width: '100%'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "briefcase",
      size: 16,
      style: {
        color: 'var(--accent)'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 500,
        fontSize: 14,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, current)), /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-down",
      size: 16,
      style: {
        color: 'var(--text-secondary)'
      }
    }))
  }, workspaces.map(ws => /*#__PURE__*/React.createElement(DropdownMenuItem, {
    key: ws.name,
    onClick: () => onToast('info', ws.current ? 'Already in this workspace' : `Switching requires a restart of open terminals`)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, ws.name), ws.current && /*#__PURE__*/React.createElement("span", {
    className: "wm-badge wm-badge--default",
    style: {
      padding: '1px 4px',
      borderRadius: 4
    }
  }, "current"))), /*#__PURE__*/React.createElement(DropdownMenuSeparator, null), /*#__PURE__*/React.createElement(DropdownMenuItem, {
    style: {
      color: 'var(--text-secondary)'
    },
    onClick: () => onToast('info', 'Add workspace — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus"
  }), " Add workspace"));
}
function WorktreeRow({
  wt,
  selected,
  onSelect,
  onArchive
}) {
  const [menu, setMenu] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    className: `wmk-wt-row ${selected ? 'wmk-wt-row--selected' : ''}`,
    onClick: onSelect,
    onContextMenu: e => {
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY
      });
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "wmk-grip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "grip-vertical",
    size: 13
  })), /*#__PURE__*/React.createElement(Icon, {
    name: "git-branch",
    size: 16,
    style: {
      color: wt.color ? `var(--wt-${wt.color})` : 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "wmk-wt-name"
  }, wt.name), wt.warning && /*#__PURE__*/React.createElement(Tooltip, {
    content: wt.warning,
    side: "right"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "triangle-alert",
    size: 14,
    style: {
      color: 'var(--warning)'
    }
  })), menu && /*#__PURE__*/React.createElement("div", {
    className: "wmk-ctx",
    style: {
      left: menu.x,
      top: menu.y
    },
    onMouseLeave: () => setMenu(null)
  }, /*#__PURE__*/React.createElement("button", {
    className: "wm-menu-item",
    onClick: e => {
      e.stopPropagation();
      setMenu(null);
      onArchive(wt.name);
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "archive"
  }), " Archive")));
}
function Sidebar({
  data,
  state,
  actions
}) {
  const [query, setQuery] = React.useState('');
  const active = state.worktrees.filter(w => !state.archived.includes(w.name));
  const archived = state.worktrees.filter(w => state.archived.includes(w.name));
  const shown = active.filter(w => !query || w.name.toLowerCase().includes(query.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-sidebar-top"
  }, /*#__PURE__*/React.createElement(WorkspaceSwitcher, {
    workspaces: data.workspaces,
    current: data.workspaces[0].name,
    onToast: actions.toast
  }), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Settings",
    side: "bottom"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon",
    onClick: () => actions.toast('info', 'Settings view — not included in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "wmk-sidebar-heading"
  }, /*#__PURE__*/React.createElement("h1", null, "Worktrees"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Tooltip, {
    content: "Refresh",
    side: "bottom"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon",
    style: {
      height: 32,
      width: 32
    },
    onClick: () => actions.toast('info', 'Remote state synced')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "rotate-cw"
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Collapse sidebar",
    side: "bottom"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon",
    style: {
      height: 32,
      width: 32
    },
    onClick: () => actions.toast('info', 'Collapsed sidebar — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevrons-left"
  }))))), /*#__PURE__*/React.createElement("div", {
    className: `wmk-main-card ${state.selected === null ? 'wmk-main-card--selected' : ''}`,
    onClick: () => actions.select(null)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "folder",
    size: 16,
    style: {
      color: 'var(--text-secondary)'
    }
  }), /*#__PURE__*/React.createElement("span", null, "Main workspace")), /*#__PURE__*/React.createElement("div", {
    className: "wmk-list"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-section-row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "wmk-section-label"
  }, "Active (", active.length, ")"), /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search worktrees",
    value: query,
    onChange: e => setQuery(e.target.value),
    style: {
      height: 28,
      width: 150,
      fontSize: 12
    }
  })), shown.map(wt => /*#__PURE__*/React.createElement(WorktreeRow, {
    key: wt.name,
    wt: wt,
    selected: state.selected === wt.name,
    onSelect: () => actions.select(wt.name),
    onArchive: actions.askArchive
  })), /*#__PURE__*/React.createElement("div", {
    className: "wmk-new-wt",
    onClick: actions.openCreate
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, "New Worktree")), /*#__PURE__*/React.createElement("div", {
    className: "wmk-section-row wmk-archive-toggle",
    onClick: actions.toggleArchived
  }, /*#__PURE__*/React.createElement("span", {
    className: "wmk-section-label"
  }, "Archive (", archived.length, ")"), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 14,
    style: {
      color: 'var(--text-muted)',
      transform: state.showArchived ? 'rotate(90deg)' : 'none',
      transition: 'transform 150ms'
    }
  })), state.showArchived && archived.map(wt => /*#__PURE__*/React.createElement("div", {
    key: wt.name,
    className: "wmk-wt-row",
    style: {
      opacity: 0.6
    },
    onClick: () => actions.select(wt.name)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 14
    }
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "archive",
    size: 16,
    style: {
      color: 'var(--text-muted)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "wmk-wt-name"
  }, wt.name))), state.showArchived && archived.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 16px',
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, "No archived worktrees")), /*#__PURE__*/React.createElement("div", {
    className: "wmk-sharebar",
    onClick: () => actions.toast('info', 'Share over network — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "share-2",
    size: 14
  }), /*#__PURE__*/React.createElement("span", null, "Share")), /*#__PURE__*/React.createElement("div", {
    className: "wmk-bottombar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "wmk-dev"
  }, "DEV"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon",
    style: {
      height: 28,
      width: 28
    },
    onClick: () => actions.toast('info', 'Log folder opened')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 14
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "icon",
    style: {
      height: 28,
      width: 28
    },
    onClick: () => actions.toast('info', 'github.com/guoyongchang/worktree-manager')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "github",
    size: 14
  })))));
}
Object.assign(window, {
  Sidebar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/TerminalPanel.jsx
try { (() => {
/* TerminalPanel — port of src/components/TerminalPanel.tsx (collapsed strip + expanded panel) */
const {
  Tooltip,
  Icon
} = window.WorktreeManagerDesignSystem_e60f48;
const FAKE_LINES = [{
  c: 'var(--text-muted)',
  t: '# worktree: windows-bug-fix · shell integration active'
}, {
  c: 'var(--success-light)',
  t: '➜ worktree-manager git:(windows-bug-fix) ✗ '
}, {
  c: 'var(--text-primary)',
  t: 'npm run tauri dev'
}, {
  c: 'var(--text-secondary)',
  t: '  VITE v7.3.1  ready in 428 ms'
}, {
  c: 'var(--text-secondary)',
  t: '  ➜  Local:   http://localhost:1420/'
}, {
  c: 'var(--accent-hover)',
  t: '  [tauri] watching for file changes…'
}];
function TerminalTab({
  name,
  active,
  onClick,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `wmk-term-tab ${active ? 'wmk-term-tab--active' : ''}`,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("span", null, name), active && onClose && /*#__PURE__*/React.createElement("button", {
    className: "wmk-term-tab-x",
    onClick: e => {
      e.stopPropagation();
      onClose();
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "x",
    size: 10
  })));
}
function TerminalPanel({
  tabs,
  expanded,
  onToggle,
  onToast
}) {
  const [activeTab, setActiveTab] = React.useState(tabs[0]);
  const shownTab = tabs.includes(activeTab) ? activeTab : tabs[0];
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-terminal",
    style: {
      height: expanded ? 240 : 32
    }
  }, expanded && /*#__PURE__*/React.createElement("div", {
    className: "wmk-term-resize"
  }), /*#__PURE__*/React.createElement("div", {
    className: "wmk-term-bar"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      paddingLeft: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: onToggle
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "terminal",
    size: 14
  })), /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: onToggle
  }, /*#__PURE__*/React.createElement(Icon, {
    name: expanded ? 'chevron-down' : 'chevron-up',
    size: 13
  }))), /*#__PURE__*/React.createElement("div", {
    className: "wmk-term-tabs"
  }, tabs.map(t => /*#__PURE__*/React.createElement(TerminalTab, {
    key: t,
    name: t,
    active: t === shownTab,
    onClick: () => {
      setActiveTab(t);
      if (!expanded) onToggle();
    },
    onClose: () => onToast('info', `Closed terminal: ${t}`)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      paddingRight: 8,
      marginLeft: 'auto'
    }
  }, expanded && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Tooltip, {
    content: "Search",
    side: "top"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Terminal search — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 13
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Voice input (hold Alt+V)",
    side: "top"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Voice input — powered by Dashscope ASR')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mic",
    size: 13
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Expand",
    side: "top"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Fullscreen terminal — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevrons-up-down",
    size: 13
  }))), /*#__PURE__*/React.createElement(Tooltip, {
    content: "Maximize",
    side: "top"
  }, /*#__PURE__*/React.createElement("button", {
    className: "wmk-mini-icon",
    onClick: () => onToast('info', 'Maximize — not in this mock')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "maximize-2",
    size: 13
  })))), /*#__PURE__*/React.createElement("button", {
    className: "wmk-term-plus",
    onClick: () => onToast('info', 'New terminal session')
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "plus",
    size: 12
  })))), expanded && /*#__PURE__*/React.createElement("div", {
    className: "wmk-term-body"
  }, FAKE_LINES.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      color: l.c
    }
  }, l.t, i === 2 ? /*#__PURE__*/React.createElement("span", {
    className: "wmk-caret"
  }) : null))));
}
Object.assign(window, {
  TerminalPanel
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/TerminalPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/app.jsx
try { (() => {
/* App shell — wires Sidebar + DetailView + modals + toasts (WorkspaceCell.tsx equivalent) */
const {
  Toast,
  ToastStack,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button
} = window.WorktreeManagerDesignSystem_e60f48;
const DATA = window.WM_DATA;
function App() {
  const [worktrees, setWorktrees] = React.useState(DATA.worktrees);
  const [archived, setArchived] = React.useState([]);
  const [selected, setSelected] = React.useState(null); // null = main workspace
  const [showArchived, setShowArchived] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [archiveConfirm, setArchiveConfirm] = React.useState(null);
  const [termExpanded, setTermExpanded] = React.useState(false);
  const [toasts, setToasts] = React.useState([]);
  const idRef = React.useRef(0);
  const toast = (type, message) => {
    const id = ++idRef.current;
    setToasts(t => [...t, {
      id,
      type,
      message
    }]);
  };
  const dismiss = id => setToasts(t => t.filter(x => x.id !== id));
  const actions = {
    toast,
    select: setSelected,
    openCreate: () => setCreateOpen(true),
    toggleArchived: () => setShowArchived(s => !s),
    askArchive: name => setArchiveConfirm(name),
    isArchived: name => archived.includes(name),
    restore: name => {
      setArchived(a => a.filter(n => n !== name));
      toast('success', `Restored ${name}`);
    }
  };
  const state = {
    worktrees,
    archived,
    selected,
    showArchived
  };
  const handleCreate = (name, projectNames) => {
    setWorktrees(w => [...w, {
      name,
      projects: projectNames.map(p => ({
        name: p,
        branch: name,
        badges: [{
          variant: 'success',
          label: 'Clean'
        }],
        stats: {
          ahead: 0,
          behind: 0,
          changed: 0
        },
        push: 'Push'
      }))
    }]);
    setCreateOpen(false);
    setSelected(name);
    toast('success', `Worktree "${name}" created — dependencies symlinked`);
  };
  const handleArchive = () => {
    setArchived(a => [...a, archiveConfirm]);
    if (selected === archiveConfirm) setSelected(null);
    toast('success', `Archived ${archiveConfirm}`);
    setArchiveConfirm(null);
  };
  const selectedWt = worktrees.find(w => w.name === selected);
  const termTabs = ['Workspace', ...(selectedWt ? (selectedWt.projects || DATA.defaultProjects).map(p => p.name).slice(0, 3) : DATA.groups[1].projects.map(p => p.name))];
  return /*#__PURE__*/React.createElement("div", {
    className: "wmk-app"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-body"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    data: DATA,
    state: state,
    actions: actions
  }), /*#__PURE__*/React.createElement("div", {
    className: "wmk-main"
  }, /*#__PURE__*/React.createElement("div", {
    className: "wmk-scroll"
  }, selectedWt ? /*#__PURE__*/React.createElement(WorktreeDetailView, {
    wt: selectedWt,
    data: DATA,
    actions: actions
  }) : /*#__PURE__*/React.createElement(WorkspaceOverview, {
    data: DATA,
    actions: actions
  })), /*#__PURE__*/React.createElement(TerminalPanel, {
    tabs: termTabs,
    expanded: termExpanded,
    onToggle: () => setTermExpanded(e => !e),
    onToast: toast
  }))), /*#__PURE__*/React.createElement(CreateWorktreeModal, {
    open: createOpen,
    onOpenChange: setCreateOpen,
    data: DATA,
    onCreate: handleCreate
  }), /*#__PURE__*/React.createElement(Dialog, {
    open: !!archiveConfirm,
    onOpenChange: () => setArchiveConfirm(null),
    maxWidth: "420px"
  }, /*#__PURE__*/React.createElement(DialogHeader, null, /*#__PURE__*/React.createElement(DialogTitle, null, "Archive worktree"), /*#__PURE__*/React.createElement(DialogDescription, null, "Archive \"", archiveConfirm, "\"? Branches are kept; the working directory is moved to the archive. You can restore it anytime.")), /*#__PURE__*/React.createElement(DialogFooter, null, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    onClick: () => setArchiveConfirm(null)
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    variant: "warning",
    onClick: handleArchive
  }, "Archive"))), /*#__PURE__*/React.createElement(ToastStack, null, toasts.map(t => /*#__PURE__*/React.createElement(Toast, {
    key: t.id,
    type: t.type,
    message: t.message,
    onClose: () => dismiss(t.id)
  }))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/worktree-manager/data.js
try { (() => {
/* Fake data for the Worktree Manager UI kit — mirrors docs/screenshots content */
window.WM_DATA = {
  workspaces: [{
    name: 'worktree-manager-space',
    path: '/Users/guo/Work/some-projects/worktree-manager-space',
    current: true
  }, {
    name: 'client-work',
    path: '/Users/guo/Work/client-work'
  }],
  workspaceTitle: 'Main workspace — some-projects',
  workspacePath: '/Users/guo/Work/some-projects/worktree-manager-space',
  vault: {
    label: 'Vault mounted',
    count: 17,
    items: [{
      name: '.memory-organizer.config.json',
      type: 'file'
    }, {
      name: 'AGENTS.md',
      type: 'file'
    }, {
      name: 'CLAUDE.md',
      type: 'file'
    }, {
      name: 'WORKSPACE.md',
      type: 'file'
    }, {
      name: 'api',
      type: 'folder'
    }, {
      name: 'architecture',
      type: 'folder'
    }, {
      name: 'bootstrap-prompt.md',
      type: 'file'
    }, {
      name: 'claude-reference',
      type: 'folder'
    }, {
      name: 'development',
      type: 'folder'
    }, {
      name: 'features',
      type: 'folder'
    }, {
      name: 'index.md',
      type: 'file'
    }, {
      name: 'ingest.md',
      type: 'file'
    }, {
      name: 'log.md',
      type: 'file'
    }, {
      name: 'mcp.servers.json',
      type: 'file'
    }, {
      name: 'memory',
      type: 'folder'
    }, {
      name: 'reference',
      type: 'folder'
    }, {
      name: 'repos.md',
      type: 'file'
    }]
  },
  groups: [{
    name: 'Repos',
    dot: 'sync',
    count: 3,
    expanded: false,
    projects: []
  }, {
    name: 'Worktree',
    dot: 'success',
    count: 3,
    expanded: true,
    projects: [{
      name: 'worktree-manager',
      branch: 'main',
      tag: 'Worktree',
      badges: [{
        variant: 'warning',
        label: '391 commits not merged to test'
      }],
      stats: {
        ahead: 0,
        behind: 0,
        changed: 0
      },
      push: 'Push'
    }, {
      name: 'worktree-manager-server',
      branch: 'main',
      tag: 'Worktree',
      tag2: 'Repo',
      badges: [{
        variant: 'warning',
        label: '1 changed file'
      }],
      stats: {
        ahead: 0,
        behind: 0,
        changed: 1
      },
      uncommitted: true,
      push: 'Commit & Push'
    }, {
      name: 'worktree-manager-obsidian-bridge',
      branch: 'main',
      tag: 'Worktree',
      badges: [{
        variant: 'success',
        label: 'Clean'
      }],
      stats: {
        ahead: 0,
        behind: 0,
        changed: 0
      },
      push: 'Push',
      warning: "Branch 'test' does not exist on remote — push it first."
    }]
  }],
  worktrees: [{
    name: 'feature-ui-optimize'
  }, {
    name: 'Ui-bug-fix'
  }, {
    name: 'ui-optimize-3',
    warning: '2 uncommitted changes in worktree-manager'
  }, {
    name: 'windows-archive-usage-check'
  }, {
    name: 'windows-bug-fix',
    warning: '1 uncommitted change in worktree-manager',
    projects: [{
      name: 'worktree-manager',
      branch: 'windows-bug-fix',
      badges: [{
        variant: 'warning',
        label: '1 changed file'
      }, {
        variant: 'warning',
        label: '269 commits not merged to test'
      }, {
        variant: 'secondary',
        label: '136 behind'
      }],
      stats: {
        ahead: 0,
        behind: 136,
        changed: 1
      },
      uncommitted: true,
      push: 'Commit & Push'
    }, {
      name: 'worktree-manager-server',
      branch: 'windows-bug-fix',
      badges: [{
        variant: 'success',
        label: 'Clean'
      }],
      stats: {
        ahead: 0,
        behind: 0,
        changed: 0
      },
      push: 'Push'
    }]
  }],
  defaultProjects: [{
    name: 'worktree-manager',
    base: 'main'
  }, {
    name: 'worktree-manager-server',
    base: 'main'
  }, {
    name: 'worktree-manager-obsidian-bridge',
    base: 'main'
  }],
  editors: ['VS Code', 'Cursor', 'IntelliJ IDEA'],
  terminals: ['Built-in', 'Terminal.app', 'iTerm2']
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/worktree-manager/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.TOAST_DURATION = __ds_scope.TOAST_DURATION;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.ToastStack = __ds_scope.ToastStack;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.DialogHeader = __ds_scope.DialogHeader;

__ds_ns.DialogFooter = __ds_scope.DialogFooter;

__ds_ns.DialogTitle = __ds_scope.DialogTitle;

__ds_ns.DialogDescription = __ds_scope.DialogDescription;

__ds_ns.DropdownMenu = __ds_scope.DropdownMenu;

__ds_ns.DropdownMenuItem = __ds_scope.DropdownMenuItem;

__ds_ns.DropdownMenuLabel = __ds_scope.DropdownMenuLabel;

__ds_ns.DropdownMenuSeparator = __ds_scope.DropdownMenuSeparator;

__ds_ns.DropdownMenuShortcut = __ds_scope.DropdownMenuShortcut;

__ds_ns.Popover = __ds_scope.Popover;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
