-- Insert a test node (needs identified_objects row first)
INSERT INTO identified_objects (mrid, name, lifecycle_state, validation)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Test Node', 'IN_SERVICE', 'APPROVED');

INSERT INTO connectivity_nodes (mrid, boundary_feeder_id, geom)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'FEEDER-TEST',
  ST_SetSRID(ST_MakePoint(-0.29, 5.65), 4326)
);