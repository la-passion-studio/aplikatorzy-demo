#!/bin/bash
# Usuwa adres aplikatorzy z /etc/hosts (cofa to, co zrobił start.command).
sudo sed -i '' '/# aplikatorzy local$/d' /etc/hosts
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder 2>/dev/null || true
echo "Adres aplikatorzy usunięty."
