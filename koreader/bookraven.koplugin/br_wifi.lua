--[[--
Wi-Fi on and off in one tap, like the Kindle's quick actions (the quick settings panel, br_quick,
and the Wi-Fi icon on the library home's top bar).

It does what KOReader's own "Toggle Wi-Fi" gesture action does (NetworkListener:onToggleWifi),
without a confirmation: Wi-Fi on → NetworkMgr:toggleWifiOff (then a short "Wi-Fi off."); Wi-Fi
off → NetworkMgr:toggleWifiOn, which connects to a known network, or shows KOReader's list of
networks when it knows none (a long-press asks for the list anyway), then a short "Connecting…".
KOReader then sends NetworkConnected / NetworkDisconnected, which the home and the panel follow.

Only on devices where KOReader controls Wi-Fi (Device:hasWifiToggle()); elsewhere (Android,
desktops) nothing is shown.
]]

local Device = require("device")
local InfoMessage = require("ui/widget/infomessage")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local _ = require("gettext")
local T = require("ffi/util").template

local Wifi = {
    CONNECT_SECONDS = 45, -- how long "Connecting…" is shown after turning Wi-Fi on (KOReader waits as long)
    asked_on = nil, -- when we last turned Wi-Fi on
}

local function manager()
    local ok, NetworkMgr = pcall(require, "ui/network/manager")
    return ok and NetworkMgr or nil
end

--- Whether KOReader can turn Wi-Fi on and off on this device.
function Wifi.available()
    local ok, has = pcall(Device.hasWifiToggle, Device)
    return ok and has and true or false
end

--- { on, connected, connecting, ssid }: what KOReader knows now.
function Wifi.state()
    local NetworkMgr = manager()
    local st = { on = false, connected = false, connecting = false }
    if not NetworkMgr then return st end
    local ok_on, on = pcall(NetworkMgr.isWifiOn, NetworkMgr)
    local ok_c, connected = pcall(NetworkMgr.isConnected, NetworkMgr)
    st.on = ok_on and on and true or false
    st.connected = st.on and ok_c and connected and true or false
    if st.on and not st.connected then
        st.connecting = (NetworkMgr.pending_connection or NetworkMgr.pending_connectivity_check) and true
            or (Wifi.asked_on ~= nil and os.time() - Wifi.asked_on < Wifi.CONNECT_SECONDS)
    end
    if st.connected then
        -- The network's name, where the platform tells it (Kindle, Kobo…).
        local ok_n, network = pcall(NetworkMgr.getCurrentNetwork, NetworkMgr)
        if ok_n and type(network) == "table" and type(network.ssid) == "string" and network.ssid ~= "" then
            st.ssid = network.ssid
        end
    end
    return st
end

--- The line under "Wi-Fi": "Connected to Home", "Connecting…", "Off"…
function Wifi.describe(st)
    st = st or Wifi.state()
    if not st.on then return _("Off") end
    if st.connected then
        return st.ssid and T(_("Connected to %1"), st.ssid) or _("Connected")
    end
    if st.connecting then return _("Connecting…") end
    return _("On, not connected")
end

--- Turns Wi-Fi off when it is on, else on (and connects). long_press: show the list of networks.
function Wifi.toggle(long_press)
    local NetworkMgr = manager()
    if not NetworkMgr or not Wifi.available() then return end
    local st = Wifi.state()
    local ok, err
    if st.on then
        Wifi.asked_on = nil
        ok, err = pcall(NetworkMgr.toggleWifiOff, NetworkMgr, nil, true) -- interactive: remembered as off
        if ok then
            UIManager:show(InfoMessage:new{ text = _("Wi-Fi off."), timeout = 1 })
        end
    else
        Wifi.asked_on = os.time()
        ok, err = pcall(NetworkMgr.toggleWifiOn, NetworkMgr, nil, long_press, true)
        if ok and not long_press then
            UIManager:show(InfoMessage:new{ text = _("Connecting…"), timeout = 2 })
        end
    end
    if not ok then
        logger.err("BookRaven: could not toggle Wi-Fi", err)
        UIManager:show(InfoMessage:new{ text = _("Could not change Wi-Fi. See crash.log for details.") })
    end
end

return Wifi
