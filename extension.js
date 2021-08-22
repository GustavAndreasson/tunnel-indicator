/*
 * tunnel-indicator@atareao.es
 *
 * Copyright (c) 2020 Lorenzo Carbonell Cerezo <a.k.a. atareao>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

imports.gi.versions.Gtk = "3.0";
imports.gi.versions.Gdk = "3.0";
imports.gi.versions.Gio = "2.0";
imports.gi.versions.Clutter = "1.0";
imports.gi.versions.St = "1.0";
imports.gi.versions.GObject = "3.0";
imports.gi.versions.GLib = "2.0";

const {Gtk, Gdk, Gio, Clutter, St, GObject, GLib} = imports.gi;

const MessageTray = imports.ui.messageTray;
const ByteArray = imports.byteArray;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;

const Gettext = imports.gettext.domain(Extension.uuid);
const _ = Gettext.gettext;


var TunnelIndicator = GObject.registerClass(
    class TunnelIndicator extends PanelMenu.Button{
        _init(){
            super._init(St.Align.START);
            this._settings = Convenience.getSettings();
            this._isActive = null;

            /* Icon indicator */
            let theme = Gtk.IconTheme.get_default();
            if (theme == null) {
                // Workaround due to lazy initialization on wayland
                // as proposed by @fmuellner in GNOME mutter issue #960
                theme = new Gtk.IconTheme();
                theme.set_custom_theme(St.Settings.get().gtk_icon_theme);
            }
            theme.append_search_path(
                Extension.dir.get_child('icons').get_path());

            let box = new St.BoxLayout();
            let label = new St.Label({text: 'Button',
                                      y_expand: true,
                                      y_align: Clutter.ActorAlign.CENTER });
            //box.add(label);
            this.icon = new St.Icon({style_class: 'system-status-icon'});
            //this._update();
            box.add(this.icon);
            this.add_child(box);
            /* Start Menu */
            this.TunnelSwitch = new PopupMenu.PopupSwitchMenuItem(
                _('Tunnels status'),
                {active: true});

            this.tunnels_section = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this.tunnels_section);
            this.tunnels_section.addMenuItem(this.TunnelSwitch);
            /* Separator */
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            /* Setings */
            this.settingsMenuItem = new PopupMenu.PopupMenuItem(_("Settings"));
            this.settingsMenuItem.connect('activate', () => {
                ExtensionUtils.openPrefs();
            });
            this.menu.addMenuItem(this.settingsMenuItem);
            /* Init */
            this._sourceId = 0;
            this._settingsChanged();
            this._settings.connect('changed',
                                   this._settingsChanged.bind(this));
        }

        _loadConfiguration(){
            this._tunnels = this._getValue('tunnels');
            this._checktime = this._getValue('checktime');
            if(this._checktime < 5){
                this._checktime = 5;
            }else if (this._checktime > 600){
                this._checktime = 600;
            }
            this._darkthem = this._getValue('darktheme')
            this._tunnelsSwitches = [];
            this.tunnels_section.actor.hide();
            if(this.tunnels_section.numMenuItems > 0){
                this.tunnels_section.removeAll();
            }
            this._tunnels.forEach((item, index, array)=>{
                let [name, tunnel] = item.split('|');
                let tunnelSwitch = new PopupMenu.PopupSwitchMenuItem(
                    name,
                    {active: false});
                tunnelSwitch.label.set_name(tunnel);
                tunnelSwitch.connect('toggled', this._toggleSwitch.bind(this)); 
                this._tunnelsSwitches.push(tunnelSwitch);
                this.tunnels_section.addMenuItem(tunnelSwitch);
                this.tunnels_section.actor.show();
            });
        }

        _checkStatus(){
            let isActive = false;
            this._tunnelsSwitches.forEach((tunnelSwitch)=>{
                if(tunnelSwitch.state){
                    isActive = true;
                }
            });
            if(this._isActive == null || this._isActive != isActive){
                this._isActive = isActive;
                this._set_icon_indicator(this._isActive);
            }
        }

        _toggleSwitch(widget, value){
            try {
                let setstatus = ((value == true) ? 'start': 'stop');
                let tunnel = tunnelSwitch.label.get_name();
                let command = ["pgrep", "-f", `"ssh ${tunnel}"`];
                let proc = Gio.Subprocess.new(
                    command,
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                );
                proc.communicate_utf8_async(null, null, (proc, res) => {
                    try{
                        let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                        log("=====================");
                        log(stdout);
                        log(stderr);
                        log("=====================");
                        this._update();
                    }catch(e){
                        logError(e);
                    }
                });
            } catch (e) {
                logError(e);
            }
        }
        _getValue(keyName){
            return this._settings.get_value(keyName).deep_unpack();
        }

        _update(){
            this._tunnelsSwitches.forEach((tunnelSwitch, index, array)=>{
                try{
                    let tunnel = tunnelSwitch.label.name;
                    log(tunnel);
                    let command = ["pgrep", "-f", `"ssh ${tunnel}"`];
                    let proc = Gio.Subprocess.new(
                        command,
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
                    );
                    proc.communicate_utf8_async(null, null, (proc, res) => {
                        try {
                            log(res);
                            let [, stdout, stderr] = proc.communicate_utf8_finish(res);
                            let active = (stdout.indexOf('Active: active') > -1);
                            GObject.signal_handlers_block_by_func(tunnelSwitch,
                                                          this._toggleSwitch);
                            tunnelSwitch.setToggleState(active);
                            GObject.signal_handlers_unblock_by_func(tunnelSwitch,
                                                            this._toggleSwitch);
                            this._checkStatus();
                        } catch (e) {
                            logError(e);
                        }
                    });
                } catch (e) {
                    logError(e);
                }
            });
            return true;
        }

        _set_icon_indicator(active){
            let darktheme = this._getValue('darktheme');
            let theme_string = (darktheme?'dark': 'light');
            let status_string = (active?'active':'paused')
            let icon_string = 'tunnel-' + status_string + '-' + theme_string;
            this.icon.set_gicon(this._get_icon(icon_string));
        }

        _get_icon(icon_name){
            let base_icon = Extension.path + '/icons/' + icon_name;
            let file_icon = Gio.File.new_for_path(base_icon + '.png')
            if(file_icon.query_exists(null) == false){
                file_icon = Gio.File.new_for_path(base_icon + '.svg')
            }
            if(file_icon.query_exists(null) == false){
                return null;
            }
            let icon = Gio.icon_new_for_string(file_icon.get_path());
            return icon;
        }

        _settingsChanged(){
            this._loadConfiguration();
            this._update();
            if(this._sourceId > 0){
                GLib.source_remove(this._sourceId);
            }
            this._sourceId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, this._checktime,
                this._update.bind(this));
        }

        disableUpdate(){
            if(this._sourceId > 0){
                GLib.source_remove(this._sourceId);
            }
        }
    }
);

let tunnelIndicator;

function init(){
    Convenience.initTranslations();
}

function enable(){
    tunnelIndicator = new TunnelIndicator();
    Main.panel.addToStatusArea('tunnelIndicator', tunnelIndicator, 0, 'right');
}

function disable() {
    tunnelIndicator.disableUpdate();
    tunnelIndicator.destroy();
}
