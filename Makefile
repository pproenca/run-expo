PREFIX ?= $(HOME)/.local
BIN_DIR := $(PREFIX)/bin
CLI := $(abspath cli/expo-ios.mjs)

.PHONY: install-local test doctor
install-local:
	mkdir -p "$(BIN_DIR)"
	ln -sf "$(CLI)" "$(BIN_DIR)/expo-ios"
	chmod +x "$(CLI)"
	@echo "Installed expo-ios to $(BIN_DIR)/expo-ios"

test:
	npm test

doctor:
	npm run doctor
