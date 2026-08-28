{
  description = "Development environment for Voiceflow XYOps automation";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forEachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.bun pkgs.nodejs_22 ];
          };
        });

      formatter = forEachSystem (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        if pkgs ? nixfmt-rfc-style then pkgs.nixfmt-rfc-style else pkgs.nixfmt);
    };
}
