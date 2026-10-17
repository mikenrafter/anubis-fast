{
  description = "Anubis Fast Firefox native-messaging bridge";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    anubis-fetch.url = "github:mikenrafter/anubis-fetch";
    anubis-fetch.inputs.nixpkgs.follows = "nixpkgs";
    # Live Firefox sessions for the Marionette tests and README captures.
    firefox-addon-live = {
      url = "github:mikenrafter/firefox-addon-live";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
  };

  outputs = { self, nixpkgs, flake-utils, anubis-fetch, firefox-addon-live, ... }:
    let
      homeModule = { config, lib, pkgs, ... }:
        let
          cfg = config.programs.anubis-fast;
          package = self.packages.${pkgs.system}.default;
        in {
          options.programs.anubis-fast = {
            enable = lib.mkEnableOption "Anubis Fast native messaging host";
            extensionId = lib.mkOption {
              type = lib.types.str;
                default = "anubis-fast@mikenrafter";
              description = "Firefox extension ID allowed to use the native host.";
            };
          };

          config = lib.mkIf cfg.enable {
            home.packages = [ package ];
            home.file.".mozilla/native-messaging-hosts/anubis_fast.json".text = builtins.toJSON {
              name = "anubis_fast";
              description = "Native Anubis proof-of-work bridge";
              path = "${package}/bin/anubis-fast-host";
              type = "stdio";
              allowed_extensions = [ cfg.extensionId ];
            };
          };
        };
    in
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        host = pkgs.buildGoModule {
          pname = "anubis-fast-host";
          version = "0.1.0";
          src = ./.;
          subPackages = [ "native" ];
          vendorHash = null;
          postInstall = ''
            mv $out/bin/native $out/bin/anubis-fast-host
          '';
        };
        package = pkgs.writeShellScriptBin "anubis-fast-host" ''
          export ANUBIS_FETCH_BIN="${anubis-fetch.packages.${system}.default}/bin/anubis-fetch"
          exec ${host}/bin/anubis-fast-host "$@"
        '';
      in {
        packages.default = package;
        packages.host = host;

        # Node, vanilla Firefox (FIREFOX_BINARY), Xvfb, ffmpeg, ImageMagick and
        # xdotool, plus the firefox-addon-live link that package.json uses.
        # Anubis is the real challenge server the live tests and captures run.
        devShells.default = firefox-addon-live.lib.devShell {
          inherit pkgs;
          packages = [
            pkgs.go
            pkgs.web-ext
            pkgs.anubis
          ];

          shellHook = ''
            echo "Anubis Fast dev shell ready: npm install && npm run build:firefox"
            echo "Live Firefox tests: npm run test:live   README captures: npm run capture:readme"
          '';
        };

      })
    ) // {
      homeModules.default = homeModule;
    };
}
