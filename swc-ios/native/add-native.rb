# Tylko przy budowaniu „SwC Gry” (workflow swc-ios.yml): dokłada do projektu Xcode wtyczkę SwcAppPlugin w aplikacji
# i rozszerzenie z widżetami „Passa” i „Otwarte stoły”. Projekt Pitayas w repozytorium zostaje bez zmian.
# Użycie (z katalogu głównego repozytorium): ruby swc-ios/native/add-native.rb <wersja> <numer_kompilacji>
require 'xcodeproj'
ver, build = ARGV[0] || '1.0.0', ARGV[1] || '1'
proj = Xcodeproj::Project.open('ios/App/App.xcodeproj')
app = proj.targets.find { |t| t.name == 'App' } or abort('Brak celu App')
appgrp = proj.main_group['App'] or abort('Brak grupy App')

# 1) wtyczka w aplikacji (plik: ios/App/App/SwcAppPlugin.swift) + uprawnienia (wspólne dane z widżetem)
app.add_file_references([appgrp.new_file('SwcAppPlugin.swift')])
appgrp.new_file('App.entitlements')
app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements' }

# 2) rozszerzenie z widżetami (pliki: ios/App/SwcWidgets/*)
w = proj.new_target(:app_extension, 'SwcWidgets', :ios, '17.0', nil, :swift)
grp = proj.main_group.new_group('SwcWidgets', 'SwcWidgets')
w.add_file_references([grp.new_file('SwcWidgets.swift')])
grp.new_file('Info.plist'); grp.new_file('SwcWidgets.entitlements')
w.add_system_framework(%w[WidgetKit SwiftUI])
w.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.pitayas.swc.widgets'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'SwcWidgets/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = 'SwcWidgets/SwcWidgets.entitlements'
  s['SWIFT_VERSION'] = '5.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['MARKETING_VERSION'] = ver
  s['CURRENT_PROJECT_VERSION'] = build
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# 3) osadzenie rozszerzenia w aplikacji (PlugIns) i kolejność budowania
phase = app.copy_files_build_phases.find { |p| p.dst_subfolder_spec == '13' } || app.new_copy_files_build_phase('Embed Foundation Extensions')
phase.dst_subfolder_spec = '13'
phase.add_file_reference(w.product_reference, true).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
app.add_dependency(w)
proj.save
puts "Dodano SwcAppPlugin i widżety (#{ver} / #{build})"
