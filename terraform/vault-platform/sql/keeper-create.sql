CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}';
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO "{{name}}";
GRANT SELECT, INSERT, DELETE ON frames TO "{{name}}";
GRANT SELECT, INSERT ON custody TO "{{name}}";
GRANT USAGE ON SEQUENCE custody_id_seq TO "{{name}}";
