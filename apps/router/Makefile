include $(TOPDIR)/rules.mk
PKG_NAME:=neko-smart-router
PKG_VERSION:=0.1.0
PKG_RELEASE:=6
PKG_LICENSE:=GPL-3.0-or-later ISC
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)
include $(INCLUDE_DIR)/package.mk
define Package/neko-smart-router
 SECTION:=net
 CATEGORY:=Network
 TITLE:=neko-smart unified privacy node and bandwidth engine
 DEPENDS:=+luci-base +luci-compat +https-dns-proxy +ca-bundle +dnsmasq +nftables-json +kmod-nf-conntrack-netlink +libubox +libnl-tiny +zlib +curl
endef
define Package/neko-smart-router/conffiles
/etc/config/neko_smart
/usr/share/neko-smart/protocols.txt
endef
define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src ./vendor $(PKG_BUILD_DIR)/
endef
define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -std=c11 -Wall -Wextra $(TARGET_LDFLAGS) -o $(PKG_BUILD_DIR)/neko-smart-observer $(PKG_BUILD_DIR)/src/packet-observer.c
	$(TARGET_CC) $(TARGET_CFLAGS) -std=gnu99 -D_GNU_SOURCE -DHAVE_ULOOP_INTERVAL -I$(STAGING_DIR)/usr/include/libnl-tiny $(TARGET_LDFLAGS) -o $(PKG_BUILD_DIR)/neko-smart-account $(PKG_BUILD_DIR)/vendor/nlbwmon/*.c -lubox -lnl-tiny -lz
endef
define Package/neko-smart-router/install
	$(CP) ./root/* $(1)/
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/usr/share/neko-smart
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/neko-smart-observer $(1)/usr/sbin/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/neko-smart-account $(1)/usr/sbin/
	ln -sf neko-smart-account $(1)/usr/sbin/neko-smart-ledger
	$(INSTALL_DATA) ./vendor/nlbwmon/protocols.txt $(1)/usr/share/neko-smart/
	$(INSTALL_DIR) $(1)/usr/share/licenses/neko-smart
	$(INSTALL_DATA) ./COPYING $(1)/usr/share/licenses/neko-smart/GPL-3.0
	$(INSTALL_DATA) ./vendor/nlbwmon/COPYING $(1)/usr/share/licenses/neko-smart/ISC
	chmod 755 $(1)/etc/init.d/neko-smart
	chmod 755 $(1)/usr/share/neko-smart/accounting.sh
	chmod 755 $(1)/usr/share/neko-smart/privacy/guard.lua
endef
$(eval $(call BuildPackage,neko-smart-router))
